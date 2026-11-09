// ─────────────────────────────────────────────────────────────────────────────
// CLASSIFIER v2 — deterministic, explainable, multi-signal bill classification.
//
// Why not "first matching subject wins" (v1)? LegiScan's Maryland subject list
// mixes the Department of Legislative Services' curated BROAD subject (always
// first) with a long tail of generic index terms ("Insurance", "Job Training",
// "Licenses"…). v1 took whichever mapped term it met first, so a credit-
// insurance licensing bill landed in Health. v2 instead adds up evidence:
//
//   signal                             weight   why
//   ─────────────────────────────────  ───────  ──────────────────────────────
//   title heading (after county name)   6–8     MD titles open with the Code
//                                               article: "Income Tax – …"
//   1st broad subject (DLS curated)     5       staff-assigned policy area
//   2nd subject                         2.5     often a second broad subject
//   specialist keywords in title        3–7     firearms, cannabis, alcohol…
//   general keywords (title / summary)  2 / 1   catch-all vocabulary
//   narrow subjects (3rd onward)        ≤ 1.5   weak but additive
//
// The highest-scoring topic is primary; a clear runner-up becomes secondary.
// Confidence comes from the size and margin of the win, and every result
// carries its evidence so a reviewer can see WHY a bill landed where it did.
//
// Accuracy is measured, not asserted: `node ingest/eval/evaluate.js` scores
// this file against 480 hand-labelled bills (ingest/eval/gold.json).
// ─────────────────────────────────────────────────────────────────────────────

import { TOPIC_BY_CODE, SUBTOPIC_CODES } from './taxonomy.js';

export const CLASSIFIER_VERSION = 'rules-v2.0';

// ── 1. Title headings ────────────────────────────────────────────────────────
// [regex on the heading, topic, subtopic|null, weight]. First match wins, so
// specific headings sit above general ones.
const H = (re, topic, sub = null, w = 7) => [re, topic, sub, w];
const TITLE_HEADS = [
  H(/retirement system|pension system|^state retirement|^pensions?\b/, 'government-admin', 'personnel-pensions', 8),
  // specialist areas first
  H(/^(regulated )?firearms?\b|^handgun|^guns?\b|^weapons?\b|^ghost gun/, 'firearms'),
  H(/^(medical )?cannabis|^psychedelic|^natural psychedelic|^task force on responsible use of natural psychedelic/, 'cannabis-gaming', 'cannabis'),
  H(/^horse racing|^racing|^maryland racing|^racetrack|^thoroughbred|^standardbred/, 'cannabis-gaming', 'horse-racing'),
  H(/^(sports wagering|gaming|internet gaming|state lottery|lottery|video lottery|casino|bingo|raffles?|gambling|fantasy)/, 'cannabis-gaming', 'gaming-wagering'),
  H(/^alcoholic beverages?|^alcohol\b/, 'alcohol-licensing'),
  H(/^(veterans?|department of veterans|maryland veterans|military|maryland military|national guard|armed forces|service members?)/, 'veterans-military', null, 6),

  // taxation
  H(/^(income tax|corporate income tax|earned income|income tax credit|individual income)/, 'taxation', 'income-tax', 8),
  H(/^(property tax|homestead|homeowners'? and homestead|tax sales?|state department of assessments)/, 'taxation', 'property-tax', 8),
  H(/^sales and use tax/, 'taxation', 'sales-use-tax', 8),
  H(/^(estate tax|maryland estate tax|inheritance tax|state transfer tax|transfer tax|recordation tax|admissions and amusement|motor fuel tax|tobacco tax|vehicle excise tax|hotel rental tax)/, 'taxation', 'other-taxes', 8),
  H(/^(tax|taxes|taxation|tax credits?|tax exemptions?|business tax|comptroller)/, 'taxation', null, 7),

  // health & human services
  H(/^(health insurance|maryland medical assistance program|medical assistance|medicaid|health benefit plans?|health maintenance|maryland health benefit exchange|maryland children'?s health)/, 'health', 'health-insurance-medicaid', 8),
  H(/^(behavioral health|mental health|substance use|overdose|opioid)/, 'health', 'behavioral-health', 8),
  H(/^(prescription drug|pharmacy benefits? managers?|pharmacists?|pharmacies|drug pricing)/, 'health', 'pharma-drugs', 8),
  H(/^(hospitals?|health care facilities|health facilities|nursing homes?|assisted living|maryland health care commission|health services cost review|certificate of need|freestanding|hospice|continuing care)/, 'health', 'facilities-providers', 8),
  H(/^(health occupations|physician assistants?|advanced practice|nurses?|nursing|dentists?|dental|optometr|chiropract|psycholog|podiatr|audiolog|physical therap|occupational therap|massage therap|state board of (physicians|pharmacy|nursing|dental|social work|professional counselors|examiners (of|in|for) (psychologists|optometry|nursing|podiatric|physical|occupational|audiologists|dietetic))|state board of dietetic|health occupations boards)/, 'health', 'health-professions', 8),
  H(/^(public health|maryland department of health|department of health|health|vital records|tissue banks|emergency department)/, 'health', 'public-health', 7),
  H(/^(human services|department of human services|social services|supplemental nutrition|snap|temporary cash|family investment|department of social and economic mobility)/, 'human-services', 'assistance-benefits', 8),
  H(/^(child abuse|child welfare|foster care|out-of-home placement|kinship)/, 'human-services', 'child-welfare', 7),
  H(/^(department of aging|aging|older adults|seniors?)/, 'human-services', 'aging', 8),
  H(/^(department of disabilities|disabilit|developmental disabilit|individuals with disabilities|maryland disability)/, 'human-services', 'disability', 8),

  // justice
  H(/^(juvenile|minors convicted as adults|department of juvenile)/, 'public-safety', 'juvenile-justice', 8),
  H(/^(criminal procedure|wiretapping|intercepted communications|evidence\b|criminal injuries)/, 'public-safety', 'criminal-procedure', 7),
  H(/^(correctional services|corrections?|department of public safety and correctional|parole|probation|incarcerated|prisons?|jails?)/, 'public-safety', 'corrections-reentry', 8),
  H(/^(police|law enforcement|department of state police|maryland police training)/, 'public-safety', 'policing', 8),
  H(/^(emergency services|emergency medical services|9-1-1|fire\b|fire protection|fire and rescue|emergency management|state fire)/, 'public-safety', 'emergency-services', 7),
  H(/^(criminal law|crimes?|crime of violence)/, 'public-safety', 'criminal-law', 6),
  H(/^(public safety)/, 'public-safety', null, 4),
  H(/^(family law|child support|child custody|custody|adoption|marriage|divorce|domestic relations|guardianship)/, 'family-civil-law', 'family-law', 8),
  H(/^(estates and trusts|register of wills|orphans'? court|trusts?\b|wills?\b|power of attorney)/, 'family-civil-law', 'estates-trusts', 8),
  H(/^(civil actions|civil procedure|civil liability|courts and judicial|tort)/, 'family-civil-law', 'civil-actions', 8),
  H(/^(courts?|judiciary|judgeships|judges?|district court|circuit court|appellate court|supreme court of maryland|judicial)/, 'family-civil-law', 'courts-judiciary', 7),

  // work
  H(/^(workers'? compensation|occupational safety)/, 'labor-employment', 'workplace-safety-comp', 8),
  H(/^(unemployment insurance|family and medical leave|paid leave|earned sick)/, 'labor-employment', 'leave-discrimination', 8),
  H(/^(collective bargaining|labor relations)/, 'labor-employment', 'labor-relations', 8),
  H(/^(labor and employment|employment|wage|minimum wage|prevailing wage|employment standards|employment discrimination|workplace|maryland department of labor|employees?\b)/, 'labor-employment', null, 7),
  H(/\b(workforce|apprentice\w*|job training|career and technical|skills training|skills-based hiring)/, 'workforce', null, 8),

  // energy, environment, agriculture
  H(/^(washington suburban sanitary|water and sewer|water companies|sewage disposal|public water)/, 'energy-utilities', 'water-sewer', 8),
  H(/^(renewable energy|net energy metering|community solar|solar|offshore wind|wind energy|energy storage|clean energy|nuclear)/, 'energy-utilities', 'renewable-energy', 8),
  H(/^(public utilities|public service commission|electric(ity| companies| cooperatives)?|natural gas|gas companies|electricity and gas|utility|utilities|certificate of public convenience)/, 'energy-utilities', 'utility-regulation', 8),
  H(/^(maryland energy administration|energy|maryland strategic energy|empower maryland|building energy|energy efficiency|electric vehicle)/, 'energy-utilities', null, 7),
  H(/^(agriculture|department of agriculture|agricultural|farm|farmers|maryland agricultural|hemp|soil conservation|noxious weeds)/, 'agriculture', 'farming', 8),
  H(/^(animal|animals|nondomesticated animal|exotic animal|veterinar|dogs?|cats?|pets?|research facilities and testing facilities that use animals)/, 'agriculture', 'animal-welfare', 8),
  H(/^(chesapeake|bay restoration|critical area|watershed|stormwater|wetlands?|water pollution|water quality|drinking water|coastal|shore)/, 'environment', 'water-bay', 8),
  H(/^(fisheries|fishing|tidal fish|oysters?|crabs?|hunting|boating|boats?|vessels?|state boat|wildlife)/, 'environment', 'fisheries-hunting', 8),
  H(/^(forest|forestry|trees?|state parks|parks|program open space|conservation|land preservation)/, 'environment', 'conservation-wildlife', 8),
  H(/^(recycling|solid waste|waste|litter|packaging|pfas|pesticide|plastic|beverage container|toxic|hazardous)/, 'environment', 'waste-pollution', 8),
  H(/^(climate|greenhouse|air quality|air pollution|emissions?)/, 'environment', 'climate-air', 8),
  H(/^(environment|department of the environment|natural resources|department of natural resources|maryland environmental service|environmental)/, 'environment', null, 7),

  // property & housing
  H(/^(landlord and tenant|landlords?|tenants?|residential leases|rental housing|rent stabilization|eviction)/, 'housing', 'landlord-tenant', 8),
  H(/^(short-term rentals?)/, 'housing', 'landlord-tenant', 8),
  H(/^(condominiums?|homeowners'? associations?|common ownership|cooperative housing|condominiums and homeowners)/, 'housing', 'common-ownership', 8),
  H(/^(housing|department of housing|affordable housing|homelessness|community development|housing and community development)/, 'housing', 'affordable-housing', 8),
  H(/^(residential (real )?property|residential foreclosures|foreclosure|homeownership|homebuyers?)/, 'housing', null, 6),
  H(/^(land use|zoning|planning|maryland building performance|building codes?|smart growth|growth)/, 'land-use-property', 'zoning-planning', 8),
  H(/^(real property|eminent domain|condemnation|real estate\b(?! brokers)|deeds?|land records|surveyors?)/, 'land-use-property', 'real-property', 7),

  // transportation
  H(/^(vehicle laws|motor vehicles?|motor vehicle administration|motor vehicle registration|drivers?'? licen|commercial driver|reckless|drunk driving|speed monitoring|automated enforcement|traffic|pedestrian|bicycle|school bus)/, 'transportation', null, 7),
  H(/^(transportation|state highway|highways?|maryland transit|maryland transportation authority|mass transit|transit|railroads?|ports?|maryland port|airports?|bwi|consolidated transportation|toll)/, 'transportation', 'transit-infrastructure', 7),
  H(/^(transportation network companies|ride ?share|taxicab|towing)/, 'transportation', null, 5),

  // money
  H(/^(insurance|private passenger motor vehicle insurance|motor vehicle insurance|maryland automobile insurance|homeowner'?s insurance|property and casualty|life insurance|title insurance|limited line|insurers?|mutual insurance|insurance producers)/, 'insurance-financial', 'insurance', 8),
  H(/^(financial institutions|credit regulation|commercial law - credit|banks?|banking|credit unions?|commercial financing|consumer credit|money transmission|mortgage lenders?|payment stablecoin|virtual currency|cryptocurrency)/, 'insurance-financial', 'banking-lending', 8),
  H(/^(consumer protection|consumer products?|maryland consumer)/, 'consumer-protection', null, 8),
  H(/^(economic development|department of commerce|maryland technology development|tedco|enterprise zones?|tourism)/, 'business-regulation', 'economic-development', 7),
  H(/^(business regulation|business occupations|occupational licensing|real estate brokers|home improvement|state board of (cosmetologists|barbers|architects|master electricians|plumbing|public accountancy|examiners of landscape|professional engineers|individual tax preparers|morticians|heating)|cosmetolog|barbers?|electricians?|plumbers?|accountants?|morticians?|cemeter)/, 'business-regulation', 'professional-licensing', 7),
  H(/^(corporations and associations|corporations?|limited liability|business entities|nonprofit|commercial law|maryland uniform)/, 'business-regulation', 'corporations-commercial', 6),
  H(/^(small,? minority|minority business|small business)/, 'business-regulation', 'small-minority-business', 7),

  // tech
  H(/^(information technology|department of information technology|state information technology|cybersecurity|cyber\b|artificial intelligence|online|social media|internet|data privacy|maryland online data|broadband|telecommunications|electronic)/, 'technology-privacy', null, 7),

  // education (after more specific "school bus" etc.)
  H(/^(higher education|institutions of higher|public institutions of higher|university|community colleges?|maryland higher education|morgan state|st\. mary'?s college|baltimore city community college|senatorial scholarships|scholarships?)/, 'education', 'higher-ed', 8),
  H(/^(child care|early childhood|prekindergarten|pre-?k\b|family child care)/, 'education', 'early-childhood', 8),
  H(/^(school construction|blueprint for maryland)/, 'education', 'k12-funding', 8),
  H(/^(county boards? of education|.*board of education|state board of education|.*board of school commissioners)/, 'education', 'school-governance', 7),
  H(/^(teachers?|educators?|school personnel)/, 'education', 'educators', 8),
  H(/^(education|public schools|primary and secondary|public and nonpublic schools|public (middle|high|elementary)|state department of education|schools?\b|students?\b|maryland public charter|community schools|nonpublic|public libraries|state library)/, 'education', null, 7),

  // government
  H(/^(election law|elections?|campaign finance|voter|voting|municipal elections|election districts|redistricting|ballot)/, 'government-admin', 'elections', 8),
  H(/^(state procurement|procurement|state finance and procurement|public works contracts|state contracts|board of public works)/, 'government-admin', 'procurement', 8),
  H(/^(state personnel|state employees|state employee)/, 'government-admin', 'personnel-pensions', 7),
  H(/^(creation of a state debt|prior authorizations|budget reconciliation|state finance|operating budget|capital budget|state budget|budget)/, 'government-admin', 'budget-finance', 8),
  H(/^(state government|general assembly|public information act|maryland public ethics|public ethics|ethics|state designations|commemorative|general provisions|constitutional officers|open meetings|governor|office of the attorney general|attorney general|secretary of state|state house|maryland historical trust|state ethics|amendments convention|united states)/, 'government-admin', 'agencies-ethics', 6),
  H(/^(constitutional amendment)/, 'government-admin', null, 3),
  H(/^(local government|counties|county|municipalities|municipal corporations|municipal|chartered counties|code counties|bi-county)/, 'local-government', null, 5),
];

// Headings that name a broad Code article rather than a policy area. When a
// title opens with one ("Criminal Law – Firearms – …", "Real Property –
// Condominiums – …") the second segment is the better guide, so the first is
// discounted and the second counts in full.
const GENERIC_HEAD_RE = /^(criminal law|crimes?|real property|labor and employment|state government|public safety|economic development|general provisions|local government|commercial law|business regulation|state personnel|department of [a-z ,]+|maryland department of [a-z ,]+|office of [a-z ,]+|governor'?s office [a-z ,]+|commemorative (days?|weeks?|months?)|state designations?|constitutional amendment)$/;

// ── 2. Subjects ──────────────────────────────────────────────────────────────
// [topic, subtopic|null, weight multiplier]. A multiplier < 1 marks broad
// subjects that DLS uses loosely (they still vote, but softly).
const S = (topic, sub = null, m = 1) => [topic, sub, m];
const SUBJECTS = {
  // DLS broad subjects (seen in position 1)
  'Primary and Secondary Education': S('education'),
  'Education - Miscellaneous': S('education', null, 0.8),
  'Education - Local Bills': S('education', 'school-governance', 0.9),
  'Higher Education': S('education', 'higher-ed'),
  'Community Colleges - Local Bills': S('education', 'higher-ed'),
  'Public Health': S('health', 'public-health', 0.9),
  'Health Occupations': S('health', 'health-professions'),
  'Health - Insurance': S('health', 'health-insurance-medicaid'),
  'Health Care Facilities and Regulation': S('health', 'facilities-providers'),
  'Health Maintenance Organizations': S('health', 'health-insurance-medicaid'),
  'Social Services - Generally': S('human-services', 'assistance-benefits'),
  'Elderly': S('human-services', 'aging'),
  'Disabled': S('human-services', 'disability'),
  'Children': S('human-services', 'child-welfare', 0.6),
  'Criminal Law - Substantive Crimes': S('public-safety', 'criminal-law'),
  'Criminal Law - Procedures': S('public-safety', 'criminal-procedure'),
  'Corrections': S('public-safety', 'corrections-reentry'),
  'Juvenile Law': S('public-safety', 'juvenile-justice'),
  'Public Safety': S('public-safety', null, 0.6),
  'Family Law': S('family-civil-law', 'family-law'),
  'Civil Actions and Procedures': S('family-civil-law', 'civil-actions'),
  'Civil Actions': S('family-civil-law', 'civil-actions'),
  'Courts and Court Personnel - Statewide': S('family-civil-law', 'courts-judiciary'),
  'Courts and Court Personnel - Local': S('family-civil-law', 'courts-judiciary', 0.6),
  'Estates and Trusts': S('family-civil-law', 'estates-trusts'),
  'Private Sector Labor and Industry': S('labor-employment'),
  'Workers\' Compensation': S('labor-employment', 'workplace-safety-comp'),
  'Unemployment Insurance': S('labor-employment', 'leave-discrimination'),
  'Human Relations': S('labor-employment', 'leave-discrimination', 0.5),
  'Environment': S('environment'),
  'Natural Resources - Generally': S('environment', 'conservation-wildlife', 0.9),
  'Hunting and Fishing': S('environment', 'fisheries-hunting'),
  'Agriculture': S('agriculture', 'farming', 0.9),
  'Utility Regulation': S('energy-utilities', 'utility-regulation'),
  'Energy and Climate': S('energy-utilities', null, 0.8),
  'Energy': S('energy-utilities', null, 0.8),
  'Real Property': S('land-use-property', 'real-property', 0.8),
  'Housing and Community Development': S('housing', 'affordable-housing'),
  'Taxes - Income': S('taxation', 'income-tax'),
  'Taxes - Property': S('taxation', 'property-tax'),
  'Taxes - Property - Local': S('taxation', 'property-tax'),
  'Taxes - Sales and Use': S('taxation', 'sales-use-tax'),
  'Taxes - Miscellaneous': S('taxation', 'other-taxes'),
  'Taxes - Miscellaneous - Local': S('taxation', 'other-taxes'),
  'Taxes - Recordation and Transfer': S('taxation', 'other-taxes'),
  'Taxes - Transportation': S('taxation', 'other-taxes'),
  'Vehicle Laws - Rules of the Road': S('transportation', 'traffic-safety'),
  'Vehicle Laws - Licensing and Regulation': S('transportation', 'vehicle-law'),
  'Vehicle Laws - Equipment and Inspections': S('transportation', 'vehicle-law'),
  'Vehicle Laws - Miscellaneous': S('transportation', 'vehicle-law'),
  'Vehicle Laws - Drunk Driving': S('transportation', 'traffic-safety'),
  'Transportation - Generally': S('transportation', 'transit-infrastructure'),
  'Transportation - Highways': S('transportation', 'transit-infrastructure'),
  'Alcoholic Beverages - Local Bills': S('alcohol-licensing', 'local-licenses'),
  'Alcoholic Beverages - By Subdivision': S('alcohol-licensing', 'local-licenses'),
  'Alcoholic Beverages - Statewide Bills': S('alcohol-licensing', 'manufacturing-sales'),
  'Gaming': S('cannabis-gaming', 'gaming-wagering'),
  'Horse Racing': S('cannabis-gaming', 'horse-racing'),
  'Cannabis': S('cannabis-gaming', 'cannabis'),
  'Insurance - Other than Health': S('insurance-financial', 'insurance'),
  'Financial Institutions': S('insurance-financial', 'banking-lending'),
  'Commercial Law - Credit Regulation': S('insurance-financial', 'banking-lending'),
  'Commercial Law - Consumer Protection': S('consumer-protection'),
  'Commercial Law - Generally': S('business-regulation', 'corporations-commercial', 0.7),
  'Corporations and Associations': S('business-regulation', 'corporations-commercial'),
  'Business Regulation': S('business-regulation', 'industry-regulation', 0.8),
  'Business Occupations and Professions': S('business-regulation', 'professional-licensing'),
  'Economic Development': S('business-regulation', 'economic-development', 0.8),
  'Information Technology - Generally': S('technology-privacy'),
  'Cybersecurity': S('technology-privacy', 'cybersecurity-it'),
  'Elections': S('government-admin', 'elections'),
  'State Government - Agencies, Offices, and Officials': S('government-admin', 'agencies-ethics', 0.45),
  'State Government - Regulations and Procedures': S('government-admin', 'agencies-ethics', 0.6),
  'State Government - General Assembly': S('government-admin', 'agencies-ethics'),
  'State Government - Procurement': S('government-admin', 'procurement'),
  'State Procurement': S('government-admin', 'procurement'),
  'State Government - Personnel': S('government-admin', 'personnel-pensions'),
  'State Government - Pensions and Retirement': S('government-admin', 'personnel-pensions'),
  'Pensions and Retirement': S('government-admin', 'personnel-pensions'),
  'Ethics': S('government-admin', 'agencies-ethics'),
  'Operating Budget': S('government-admin', 'budget-finance'),
  'Capital Budget': S('government-admin', 'budget-finance'),
  'Prior Authorizations': S('government-admin', 'budget-finance'),
  'Local Debt (Bond Bills)': S('local-government', 'local-finance'),
  'Counties - Local Laws': S('local-government', 'county-governance', 0.6),
  'Counties - Generally': S('local-government', 'county-governance', 0.7),
  'Local Government - Generally': S('local-government', null, 0.6),
  'Municipalities': S('local-government', 'county-governance', 0.8),
  'Bi-County Agencies': S('local-government', null, 0.5),

  // topical narrow subjects (weak votes)
  'Guns': S('firearms', null, 1.6), 'Weapons': S('firearms', null, 0.8),
  'Cannabis Distribution': S('cannabis-gaming', 'cannabis'), 'Cannabis Production': S('cannabis-gaming', 'cannabis'),
  'Cannabis Administration, Maryland': S('cannabis-gaming', 'cannabis'),
  'Gaming and Gambling': S('cannabis-gaming', 'gaming-wagering'), 'Lottery': S('cannabis-gaming', 'gaming-wagering'),
  'Casinos': S('cannabis-gaming', 'gaming-wagering'), 'Lottery and Gaming Control Agency, State': S('cannabis-gaming', 'gaming-wagering'),
  'Alcoholic Beverages Licenses': S('alcohol-licensing'), 'Alcoholic Beverages Distribution': S('alcohol-licensing'),
  'Alcoholic Beverages': S('alcohol-licensing'), 'Breweries': S('alcohol-licensing', 'manufacturing-sales'),
  'Wineries': S('alcohol-licensing', 'manufacturing-sales'), 'Distilleries': S('alcohol-licensing', 'manufacturing-sales'),
  'Alcoholic Beverages Manufacturing': S('alcohol-licensing', 'manufacturing-sales'),
  'Veterans': S('veterans-military'), 'Veterans and Military Families, Department of': S('veterans-military', null, 1.6),
  'Military Families': S('veterans-military'), 'Armed Forces': S('veterans-military', null, 0.8),
  'Armed Forces and Uniformed Services': S('veterans-military', null, 0.8),
  'Renewable Energy Sources': S('energy-utilities', 'renewable-energy'), 'Solar Energy': S('energy-utilities', 'renewable-energy'),
  'Wind Energy': S('energy-utilities', 'renewable-energy'), 'Clean Energy Credits': S('energy-utilities', 'renewable-energy'),
  'Power Plants': S('energy-utilities', 'utility-regulation'), 'Public Service Commission': S('energy-utilities', 'utility-regulation'),
  'Utilities': S('energy-utilities', 'utility-regulation', 0.8), 'Charging Stations': S('energy-utilities', 'efficiency-buildings'),
  'Electric Motor Vehicles': S('energy-utilities', 'efficiency-buildings', 0.6), 'Energy Administration': S('energy-utilities'),
  'Energy Technology and Infrastructure': S('energy-utilities'), 'Heating and Cooling': S('energy-utilities', 'efficiency-buildings', 0.6),
  'Air Pollution': S('environment', 'climate-air'), 'Climate Resiliency': S('environment', 'climate-air'),
  'Water Pollution': S('environment', 'water-bay'), 'Chesapeake Bay': S('environment', 'water-bay'),
  'Chesapeake Bay Restoration': S('environment', 'water-bay'), 'Wetlands': S('environment', 'water-bay'),
  'Coastal Bays': S('environment', 'water-bay'), 'Rivers, Streams, and Lakes': S('environment', 'water-bay'),
  'Flood Control': S('environment', 'water-bay', 0.7), 'Sediment Control': S('environment', 'water-bay'),
  'Recycling': S('environment', 'waste-pollution'), 'Refuse Disposal': S('environment', 'waste-pollution'),
  'Litter': S('environment', 'waste-pollution'), 'Hazardous and Toxic Substances': S('environment', 'waste-pollution'),
  'Pollution': S('environment', 'waste-pollution'), 'Plastics': S('environment', 'waste-pollution'),
  'Forests and Parks': S('environment', 'conservation-wildlife'), 'Trees': S('environment', 'conservation-wildlife'),
  'Conservation': S('environment', 'conservation-wildlife'), 'Program Open Space': S('environment', 'conservation-wildlife'),
  'Fish and Fishing': S('environment', 'fisheries-hunting'), 'Oysters': S('environment', 'fisheries-hunting'),
  'Hunting': S('environment', 'fisheries-hunting'), 'Crabs': S('environment', 'fisheries-hunting'),
  'Aquaculture': S('environment', 'fisheries-hunting'), 'Boats and Ships': S('environment', 'fisheries-hunting', 0.6),
  'Environmental Justice': S('environment'), 'Environment, Department of the': S('environment', null, 0.8),
  'Natural Resources, Department of': S('environment', null, 0.8), 'Environmental Matters': S('environment', null, 0.4),
  'Farmland': S('agriculture', 'farming'), 'Farmers and Farming': S('agriculture', 'farming'),
  'Livestock': S('agriculture', 'farming'), 'Hemp': S('agriculture', 'farming'), 'Agritourism': S('agriculture', 'farming'),
  'Agriculture, Department of': S('agriculture', null, 0.6), 'Soil Conservation': S('agriculture', 'farming'),
  'Animals': S('agriculture', 'animal-welfare', 0.8), 'Animal Shelters and Rescues': S('agriculture', 'animal-welfare'),
  'Dogs': S('agriculture', 'animal-welfare'), 'Veterinarians': S('agriculture', 'animal-welfare'),
  'Domestic Animals': S('agriculture', 'animal-welfare'),
  'Tax Credits': S('taxation', 'credits-incentives'), 'Income Tax': S('taxation', 'income-tax'),
  'Property Tax': S('taxation', 'property-tax'), 'Sales and Use Tax': S('taxation', 'sales-use-tax'),
  'Excise Tax': S('taxation', 'other-taxes'), 'Admissions and Amusement Tax': S('taxation', 'other-taxes'),
  'Homestead Property Tax Credit': S('taxation', 'property-tax'), 'Tax Sales': S('taxation', 'property-tax'),
  'Revenue and Taxes': S('taxation', null, 0.15), 'Enterprise Zones': S('taxation', 'credits-incentives', 0.7),
  'Mental and Behavioral Health': S('health', 'behavioral-health'), 'Substance Abuse Treatment': S('health', 'behavioral-health'),
  'Substance Abuse': S('health', 'behavioral-health'), 'Opioids': S('health', 'behavioral-health'),
  'Medical Assistance': S('health', 'health-insurance-medicaid'), 'Health Insurance': S('health', 'health-insurance-medicaid'),
  'Health Benefit Exchange': S('health', 'health-insurance-medicaid'), 'Managed Care Organizations': S('health', 'health-insurance-medicaid'),
  'Pharmacy Benefits Managers': S('health', 'pharma-drugs'), 'Pharmacists and Pharmacies': S('health', 'pharma-drugs'),
  'Drugs': S('health', 'pharma-drugs', 0.6), 'Hospitals': S('health', 'facilities-providers'),
  'Nursing Homes': S('health', 'facilities-providers'), 'Assisted Living': S('health', 'facilities-providers'),
  'Health Care Facilities': S('health', 'facilities-providers'), 'Health Services Cost Review Commission': S('health', 'facilities-providers'),
  'Health Care Commission': S('health', 'facilities-providers'), 'Physicians': S('health', 'health-professions', 0.6),
  'Nurses': S('health', 'health-professions', 0.6), 'Health': S('health', null, 0.5), 'Health, Department of': S('health', null, 0.4),
  'Immunization': S('health', 'public-health'), 'Abortion': S('health', 'public-health'),
  'Food Stamps': S('human-services', 'assistance-benefits'), 'Supplemental Nutrition Assistance Program': S('human-services', 'assistance-benefits'),
  'Public Benefits': S('human-services', 'assistance-benefits'), 'Poverty': S('human-services', 'assistance-benefits', 0.7),
  'Foster Care': S('human-services', 'child-welfare'), 'Child Abuse and Neglect': S('human-services', 'child-welfare', 0.7),
  'Aging, Department of': S('human-services', 'aging'), 'Elderly Persons (65+)': S('human-services', 'aging', 0.7),
  'Developmental Disabilities': S('human-services', 'disability'), 'Developmentally Disabled Persons': S('human-services', 'disability'),
  'Disabilities, Department of': S('human-services', 'disability'), 'Human Services, Department of': S('human-services', null, 0.7),
  'Child Care': S('education', 'early-childhood'), 'Early Childhood Education': S('education', 'early-childhood'),
  'Teachers': S('education', 'educators'), 'Education, Boards of': S('education', 'school-governance', 0.5),
  'Public Schools': S('education', null, 0.6), 'Students': S('education', 'curriculum-students', 0.5),
  'Curriculum': S('education', 'curriculum-students', 0.6), 'Scholarships and Student Financial Aid': S('education', 'higher-ed'),
  'State Universities and Colleges': S('education', 'higher-ed'), 'Community Colleges': S('education', 'higher-ed'),
  'Tuition': S('education', 'higher-ed'), 'Special Education': S('education', 'curriculum-students'),
  'Law Enforcement': S('public-safety', 'policing', 0.6), 'Police Conduct': S('public-safety', 'policing'),
  'Correctional Institutions': S('public-safety', 'corrections-reentry'), 'Parole and Probation': S('public-safety', 'corrections-reentry'),
  'Prerelease and Reentry': S('public-safety', 'corrections-reentry'), 'Incarcerated Individuals': S('public-safety', 'corrections-reentry'),
  'Victims': S('public-safety', 'victims-records'), 'Domestic Violence': S('public-safety', 'victims-records'),
  'Expungement and Shielded Records': S('public-safety', 'victims-records'), 'Expungement': S('public-safety', 'victims-records'),
  'Juvenile Justice and Delinquency': S('public-safety', 'juvenile-justice'), 'Juvenile Services, Department of': S('public-safety', 'juvenile-justice'),
  'Crimes and Punishments': S('public-safety', 'criminal-law', 0.5), 'Emergency Medical Services': S('public-safety', 'emergency-services', 0.7),
  'Fire Protection': S('public-safety', 'emergency-services', 0.7), 'Emergency Management, Department of': S('public-safety', 'emergency-services'),
  'Child Custody': S('family-civil-law', 'family-law'), 'Divorce': S('family-civil-law', 'family-law'),
  'Marriage': S('family-civil-law', 'family-law'), 'Support of Dependents': S('family-civil-law', 'family-law'),
  'Statutes of Limitation': S('family-civil-law', 'civil-actions'), 'Torts': S('family-civil-law', 'civil-actions'),
  'Damages': S('family-civil-law', 'civil-actions', 0.4), 'Power of Attorney': S('family-civil-law', 'estates-trusts'),
  'Judges': S('family-civil-law', 'courts-judiciary', 0.6),
  'Collective Bargaining': S('labor-employment', 'labor-relations'), 'Unions': S('labor-employment', 'labor-relations'),
  'Overtime': S('labor-employment', 'wages-hours'), 'Leave': S('labor-employment', 'leave-discrimination'),
  'Occupational Safety': S('labor-employment', 'workplace-safety-comp'), 'Workplace Retaliation': S('labor-employment', 'leave-discrimination'),
  'Apprentices': S('workforce', 'training-apprenticeship', 0.8), 'Apprenticeships and Internships': S('workforce', 'training-apprenticeship', 0.8),
  'Job Training': S('workforce', 'training-apprenticeship', 0.25),
  'Landlords and Tenants': S('housing', 'landlord-tenant', 1.4), 'Eviction': S('housing', 'landlord-tenant'),
  'Security Deposits': S('housing', 'landlord-tenant'), 'Leases and Rent': S('housing', 'landlord-tenant', 0.6),
  'Condominiums': S('housing', 'common-ownership', 1.4), 'Homeowners Associations': S('housing', 'common-ownership', 1.4),
  'Homeowner Associations': S('housing', 'common-ownership', 1.4), 'Common Ownership Communities': S('housing', 'common-ownership', 1.4),
  'Housing': S('housing', null, 0.6), 'Housing and Community Development, Department of': S('housing', 'affordable-housing'),
  'Foreclosure': S('housing', 'homeownership'), 'Mortgages': S('housing', 'homeownership', 0.6),
  'Zoning and Planning': S('land-use-property', 'zoning-planning'), 'Building Codes': S('land-use-property', 'zoning-planning', 0.7),
  'Condemnation': S('land-use-property', 'real-property'), 'Planning, Department of': S('land-use-property', 'zoning-planning'),
  'Smart Growth': S('land-use-property', 'zoning-planning'),
  'Motor Vehicles': S('transportation', null, 0.6), 'Highways': S('transportation', 'transit-infrastructure', 0.6),
  'Mass Transit': S('transportation', 'transit-infrastructure'), 'Drivers\' Licenses': S('transportation', 'vehicle-law'),
  'Traffic Regulation': S('transportation', 'traffic-safety'), 'Pedestrians': S('transportation', 'traffic-safety'),
  'Bicycles': S('transportation', 'traffic-safety'), 'Railroads': S('transportation', 'transit-infrastructure'),
  'Motor Vehicle Registration': S('transportation', 'vehicle-law'), 'Motor Vehicle Administration': S('transportation', 'vehicle-law'),
  'Traffic Monitoring': S('transportation', 'traffic-safety'), 'Transportation, Department of': S('transportation', null, 0.6),
  'Motor Vehicle Insurance': S('insurance-financial', 'insurance'), 'Insurance Administration': S('insurance-financial', 'insurance', 0.6),
  'Banks and Trust Companies': S('insurance-financial', 'banking-lending'), 'Credit Unions': S('insurance-financial', 'banking-lending'),
  'Cryptocurrency': S('insurance-financial', 'banking-lending'), 'Finance Companies': S('insurance-financial', 'banking-lending'),
  'Financial Regulation, Division of': S('insurance-financial', 'banking-lending'), 'Credit': S('insurance-financial', 'banking-lending', 0.5),
  'Consumer Protection': S('consumer-protection', null, 0.8), 'Unfair Trade Practices': S('consumer-protection', 'unfair-practices'),
  'Debt Collection': S('consumer-protection', 'debt-collection'), 'Warranties': S('consumer-protection', 'product-safety'),
  'Labeling': S('consumer-protection', 'product-safety', 0.5),
  'Minority Business Enterprises': S('business-regulation', 'small-minority-business'), 'Small Business': S('business-regulation', 'small-minority-business', 0.7),
  'Commerce, Department of': S('business-regulation', 'economic-development'),
  'Artificial Intelligence': S('technology-privacy', 'ai-emerging-tech'), 'Social Media': S('technology-privacy', 'data-privacy'),
  'Privacy': S('technology-privacy', 'data-privacy', 0.6), 'Personal Identifying Information': S('technology-privacy', 'data-privacy'),
  'Internet Access': S('technology-privacy', 'broadband-telecom'), 'Telecommunications': S('technology-privacy', 'broadband-telecom'),
  'Information Technology, Department of': S('technology-privacy', 'cybersecurity-it'), 'Deepfakes': S('technology-privacy', 'ai-emerging-tech'),
  'Campaign Financing': S('government-admin', 'elections'), 'Voting': S('government-admin', 'elections'),
  'Ballots': S('government-admin', 'elections'), 'Elections, State Board of': S('government-admin', 'elections'),
  'Absentee and Mail-In Ballots': S('government-admin', 'elections'), 'Retirement': S('government-admin', 'personnel-pensions', 0.6),
  'State Employees': S('government-admin', 'personnel-pensions', 0.6), 'Public Information': S('government-admin', 'agencies-ethics', 0.5),
  'Open Government': S('government-admin', 'agencies-ethics', 0.5), 'Holidays and Special Dates': S('government-admin', 'agencies-ethics', 0.5),
  'Chartered Counties': S('local-government', 'county-governance', 0.6), 'County Councils': S('local-government', 'county-governance'),
  'County Commissioners': S('local-government', 'county-governance'), 'County Executives': S('local-government', 'county-governance'),
};

// ── 3. Keywords ──────────────────────────────────────────────────────────────
// [regex, title weight, summary weight]. Specialist vocabularies carry more
// weight because they are rarely used outside their area.
const K = (re, t = 2, d = 1) => [re, t, d];
const KEYWORDS = {
  'firearms': [K(/\b(firearms?|handguns?|guns?|ammunition|ghost guns?|assault (weapon|long gun)|rifles?|shotguns?|gun shows?)\b/, 7, 2)],
  'cannabis-gaming': [K(/\b(cannabis|marijuana|psilocybin|psychedelic|dispensar)/, 6, 2),
    K(/\b(sports wagering|gaming|lottery|casinos?|bingo|raffles?|wagers?|wagering|gambling|video lottery)\b/, 6, 2),
    K(/\b(horse racing|racehorse|racetracks?|racing commission|thoroughbred|standardbred|purses)\b/, 6, 2)],
  'alcohol-licensing': [K(/\b(alcoholic beverages?|liquor|beer|wine|brewer(y|ies)|winer(y|ies)|distiller(y|ies)|taprooms?|license commissioners)\b/, 6, 2)],
  'veterans-military': [K(/\b(veterans?|military|national guard|armed forces|service ?members?|gold star|uniformed services)\b/, 3, 1)],
  'taxation': [K(/\b(tax|taxes|taxation|taxable|subtraction modification|tax credits?|exemption from the (sales|property|income))\b/, 3, 1)],
  'education': [K(/\b(schools?|students?|teachers?|education|educational|curriculum|universit(y|ies)|colleges?|prekindergarten|child care|blueprint|scholarships?|tuition)\b/, 2, 1)],
  'health': [K(/\b(health|medical|hospitals?|medicaid|physicians?|nurs(e|es|ing)|patients?|pharmac(y|ies|ists?)|prescription|clinical|disease|behavioral health|mental health|overdose|dental)\b/, 2, 1)],
  'human-services': [K(/\b(social services|snap|public assistance|foster care|seniors?|older adults|aging|disabilit(y|ies)|developmental|food insecurity|benefits recipients|kinship)\b/, 2, 1)],
  'public-safety': [K(/\b(crim(e|es|inal)|offen(se|ses|der)|sentenc\w*|prison\w*|incarcerat\w*|parole|probation|police|law enforcement|correctional|victims?|expunge\w*|juvenile|arrest|warrants?|felony|misdemeanor|9-1-1|fire(fighters?)?\b|emergency medical)/, 2, 1)],
  'family-civil-law': [K(/\b(custody|child support|divorce|adoption|guardianship|protective orders?|civil actions?|lawsuits?|liability|damages|statute of limitations|judges?|courts?|orphans' court|estates?|trusts?|wills?)\b/, 2, 0.6)],
  'labor-employment': [K(/\b(employers?|employees?|wages?|overtime|minimum wage|prevailing wage|workers?'? compensation|unemployment insurance|collective bargaining|unions?|paid leave|workplace|noncompete)\b/, 2, 1)],
  'workforce': [K(/\b(workforce|apprentice(s|ship|ships)?|job training|career and technical|skills training|pre-?apprenticeship)\b/, 5, 1.5)],
  'environment': [K(/\b(environment(al)?|conservation|wildlife|forests?|trees|native plants?|pollinators?|wetlands?|stormwater|chesapeake|bay|watershed|pollution|emissions?|climate|greenhouse|recycl\w*|waste|litter|pfas|pesticides?|fish(ing|eries)?|oysters?|crabs?|hunting|boat(s|ing)?|parks?)\b/, 2, 1)],
  'energy-utilities': [K(/\b(energy|electric(ity)?|natural gas|gas company|utilit(y|ies)|public service commission|solar|wind|renewable|ratepayers?|net metering|power plants?|transmission lines?|storage system|empower|electrification|charging)\b/, 3, 1)],
  'agriculture': [K(/\b(agricultur(e|al)|farms?|farmers?|farming|crops?|livestock|hemp|animals?|pets?|veterinar(y|ian)|dogs?|cats?|poultry|dairy|milk)\b/, 3, 1)],
  'insurance-financial': [K(/\b(insurance|insurers?|policyholders?|premiums?|banks?|banking|credit unions?|lenders?|lending|loans?|mortgage lenders|financial institutions?|money transmi\w*|stablecoin|crypto\w*)\b/, 2, 1)],
  'business-regulation': [K(/\b(business(es)?|economic development|commerce|corporations?|licensees?|licensure|occupational licens\w*|contractors?|entrepreneur|small business|minority business|industry)\b/, 1.5, 0.6)],
  'consumer-protection': [K(/\b(consumers?|consumer protection|deceptive|unfair (or deceptive )?trade|scams?|fraud|warrant(y|ies)|refunds?|debt collect|automatic renewal|junk fees)\b/, 3, 1)],
  'technology-privacy': [K(/\b(data privacy|personal data|privacy|online|internet|social media|artificial intelligence|\bai\b|algorithm|cybersecurity|cyber\w*|broadband|telecommunications|information technology|deepfakes?|digital)\b/, 3, 1)],
  'housing': [K(/\b(housing|landlords?|tenants?|rent(al|s)?\b|evictions?|leases?|condominiums?|homeowners associations?|homeless|affordable housing|homeownership|foreclosures?)\b/, 3, 1)],
  'land-use-property': [K(/\b(zoning|land use|comprehensive plans?|development|real property|deeds?|eminent domain|condemnation|building codes?|subdivision)\b/, 2, 0.8)],
  'transportation': [K(/\b(vehicles?|motor vehicles?|drivers?|driving|traffic|highways?|roads?|transit|mta|rail(road)?s?|ports?|airports?|tolls?|speed|pedestrians?|bicycl\w*|school buses|registration plates?)\b/, 2, 1)],
  'government-admin': [K(/\b(elections?|voters?|voting|ballots?|campaign finance|procurement|appropriations?|state debt|budget|pension|retirement system|state employees?|ethics|public information act|open meetings|general assembly|commemorative|state designations?)\b/, 2, 1)],
  'local-government': [K(/\b(county council|county commissioners|county executive|municipal corporation|charter (county|amendment)|local government)\b/, 1, 0.5)],
};

// ── 4. Subtopic keywords (only within the chosen primary topic) ─────────────
const SUB_KEYWORDS = {
  'environment': {
    'climate-air': /\b(climate|greenhouse|emissions?|air quality|air pollution|carbon)/,
    'water-bay': /\b(chesapeake|bay|watershed|stormwater|wetlands?|drinking water|water quality|critical area|shoreline|septic|wells?|floodplain|stream)/,
    'waste-pollution': /\b(waste|recycl|packaging|pfas|toxic|hazardous|pesticides?|litter|plastic|sludge|compost|dumping|pollution|beverage containers?)/,
    'conservation-wildlife': /\b(conservation|forests?|trees?|parks?|wildlife|program open space|preservation|habitat|native plant|geological|lands?\b)/,
    'fisheries-hunting': /\b(fish(ing|eries)?|oysters?|crabs?|hunting|boat(s|ing)?|vessels?|catfish|seafood|clams?)/,
  },
  'energy-utilities': {
    'renewable-energy': /\b(solar|wind|renewable|storage|net (energy )?metering|community solar|nuclear|clean energy|geothermal)/,
    'utility-regulation': /\b(public service commission|rates?|electric compan|gas compan|ratepayers?|utility|utilities|supplier|transmission|infrastructure)/,
    'efficiency-buildings': /\b(efficiency|empower|building energy|electrification|charging|electric vehicle|heat pumps?)/,
    'water-sewer': /\b(water|sewer|sewage|wssc|sanitary)/,
  },
  'agriculture': {
    'farming': /\b(farm|agricultur|crops?|weeds?|soil|hemp|milk|dairy|livestock|food)/,
    'animal-welfare': /\b(animals?|pets?|dogs?|cats?|veterinar|cruelty|shelters?|horses?)/,
  },
  'taxation': {
    'income-tax': /\b(income tax|subtraction modification|earned income|itemized|withholding)/,
    'property-tax': /\b(property tax|assessments?|homestead|tax sales?|real property tax)/,
    'sales-use-tax': /\b(sales and use tax|sales tax)/,
    'credits-incentives': /\b(business|employer|enterprise zone|revitalization|incentive|investment|job creation|research and development)\b.*\bcredit|\bcredit\b.*\b(business|employer|enterprise|revitalization|investment|hiring)/,
    'other-taxes': /\b(estate tax|inheritance|transfer tax|recordation|admissions and amusement|fuel tax|excise tax|hotel rental|tobacco tax|wealth tax)/,
  },
  'education': {
    'k12-funding': /\b(funding|formula|blueprint|state aid|appropriation|school construction|cost-share|grants?)/,
    'curriculum-students': /\b(curriculum|instruction|students?|course|graduation|testing|discipline|bullying|special education|school safety|health services|meals|breakfast|lunch)/,
    'educators': /\b(teachers?|educators?|school personnel|school employees|certification|career ladder|staff)/,
    'school-governance': /\b(board of education|county board|school board|board of school commissioners|superintendent|members?)/,
    'higher-ed': /\b(higher education|universit|college|tuition|scholarships?|postsecondary|campus)/,
    'early-childhood': /\b(child care|prekindergarten|pre-k|early childhood|infants?|toddlers?)/,
  },
  'public-safety': {
    'criminal-law': /\b(crimes?|offenses?|penalt|prohibit|felony|misdemeanor|assault|theft|murder|controlled dangerous)/,
    'criminal-procedure': /\b(criminal procedure|warrants?|evidence|pretrial|trial|hearsay|wiretap|interception|bail|statements?)/,
    'policing': /\b(police|law enforcement|officers?|sheriffs?|state police|immigration enforcement)/,
    'corrections-reentry': /\b(correctional|prisons?|incarcerat|parole|probation|reentry|diminution|inmates?|detention facilit)/,
    'juvenile-justice': /\b(juvenile|minors? (charged|convicted)|youth)/,
    'victims-records': /\b(victims?|expunge|records|domestic violence|sexual assault evidence|criminal injuries)/,
    'emergency-services': /\b(9-1-1|fire\b|fire and|emergency medical|ems\b|emergency services|rescue|smoke)/,
  },
  'firearms': {
    'purchase-permitting': /\b(permits?|licen[cs]e|qualification|dealers?|purchase|background|buyback|sale)/,
    'possession-carry': /\b(carry|possess|storage|trespass|sensitive|prohibited|ghost)/,
  },
  'family-civil-law': {
    'family-law': /\b(custody|child support|divorce|adoption|marriage|guardianship|protective orders?|visitation|alimony|parent)/,
    'civil-actions': /\b(civil actions?|lawsuits?|liability|damages|limitations|immunity|attorney'?s fees|defamation)/,
    'courts-judiciary': /\b(courts?|judges?|judgeships|judiciary|clerks?|jurisdiction|court fees)/,
    'estates-trusts': /\b(estates?|trusts?|wills?|probate|orphans|register of wills|personal representative|disabled person)/,
  },
  'labor-employment': {
    'wages-hours': /\b(wages?|overtime|minimum wage|prevailing wage|pay\b|hours)/,
    'workplace-safety-comp': /\b(workers'? compensation|occupational safety|heat stress|workplace safety|injur)/,
    'labor-relations': /\b(collective bargaining|unions?|labor organization|arbitration)/,
    'leave-discrimination': /\b(leave|unemployment insurance|discriminat|famli|family and medical|retaliat|accommodation)/,
  },
  'workforce': {
    'training-apprenticeship': /\b(apprentice|training|career and technical|pre-?apprenticeship|internship)/,
    'workforce-programs': /\b(workforce (development|programs?|board|grants?)|hiring|employment program|pilot program|workforce)/,
  },
  'health': {
    'public-health': /\b(public health|disease|vaccin|immuniz|tobacco|vaping|cancer|maternal|infant|abortion|vital records|medical examiner|sickle cell|commission on|health equity)/,
    'behavioral-health': /\b(mental health|behavioral health|substance|overdose|opioid|addiction|crisis|suicide|psychiatric)/,
    'health-insurance-medicaid': /\b(health insurance|medical assistance|medicaid|insurers|carriers|coverage|health benefit|health maintenance|exchange|cost sharing)/,
    'facilities-providers': /\b(hospitals?|nursing homes?|assisted living|facilit(y|ies)|certificate of need|health care commission|cost review|emergency department)/,
    'health-professions': /\b(board of|licens|scope of practice|practitioners?|physicians?|nurses?|psychologists?|dentists?|pharmacists?|physician assistants?|optometr)/,
    'pharma-drugs': /\b(prescription drugs?|drug pricing|pharmacy benefits?|pbms?|pharmacies|affordability board|insulin)/,
  },
  'human-services': {
    'assistance-benefits': /\b(snap|nutrition|cash assistance|public assistance|benefits|economic mobility|energy assistance|poverty)/,
    'child-welfare': /\b(foster|child abuse|child welfare|kinship|out-of-home|child protective)/,
    'aging': /\b(aging|seniors?|older|elderly|long-term care)/,
    'disability': /\b(disabilit|developmental|accessib|deaf|blind|service animal)/,
  },
  'insurance-financial': {
    'insurance': /\b(insurance|insurers?|policyholders?|premiums?|producers?|underwrit)/,
    'banking-lending': /\b(banks?|banking|credit|lend|loans?|mortgage|financing|stablecoin|money transmi|financial institutions?)/,
  },
  'business-regulation': {
    'economic-development': /\b(economic development|commerce|incentive|tourism|entrepreneur|business attraction|tax increment|tedco|investment fund|sports tourism)/,
    'professional-licensing': /\b(licens|board of|certification|registration|cosmetolog|barbers?|contractors?|home improvement|real estate brokers?|occupational)/,
    'corporations-commercial': /\b(corporations?|limited liability|partnerships?|nonprofit|commercial law|contracts?|business entit)/,
    'industry-regulation': /\b(industry|dealers?|manufacturers?|cemeter|towing|retail|venues?|carriers?)/,
    'small-minority-business': /\b(small business|minority business|women-owned|mbe|disadvantaged business)/,
  },
  'consumer-protection': {
    'unfair-practices': /\b(deceptive|unfair|scams?|fraud|fees?|refunds?|disclos|retail|gift cards?)/,
    'product-safety': /\b(product safety|labeling|warrant|recall|batter(y|ies)|toys?)/,
    'debt-collection': /\b(debt|collection|credit report)/,
  },
  'technology-privacy': {
    'data-privacy': /\b(privacy|personal (data|information)|social media|online|children'?s data|kids code|biometric)/,
    'ai-emerging-tech': /\b(artificial intelligence|\bai\b|algorithm|deepfake|automated decision)/,
    'cybersecurity-it': /\b(cyber|information technology|department of information technology|state it|software|applications)/,
    'broadband-telecom': /\b(broadband|telecommunications|cable|5g|internet access|cellular)/,
  },
  'housing': {
    'landlord-tenant': /\b(landlords?|tenants?|leases?|rent|evict|rental)/,
    'affordable-housing': /\b(affordable|homeless|housing (program|fund|authorit)|community development|dhcd|housing innovation)/,
    'common-ownership': /\b(condominiums?|homeowners associations?|common ownership|cooperative housing|community associations?)/,
    'homeownership': /\b(homeowner(ship)?|homebuyers?|foreclosure|mortgage|first-time)/,
  },
  'land-use-property': {
    'zoning-planning': /\b(zoning|planning|comprehensive plan|development|building codes?|building performance|growth)/,
    'real-property': /\b(real property|deeds?|titles?|liens?|easements?|eminent domain|condemnation|sales? of|surveys?)/,
  },
  'transportation': {
    'transit-infrastructure': /\b(highways?|transit|rail|ports?|airports?|tolls?|transportation (trust fund|program)|mta|infrastructure|bridges?|roads?)/,
    'vehicle-law': /\b(registration|titles?|license plates?|registration plates?|driver'?s licen|commercial driver|mva|motor vehicle administration|dealers?|permits?|emissions inspection|tinted|towed|historic motor)/,
    'traffic-safety': /\b(speed|traffic|reckless|aggressive|drunk|impaired|pedestrians?|bicycl|motorcycl|helmets?|school bus|crash|cameras?|distracted)/,
  },
  'alcohol-licensing': {
    'local-licenses': /\b(county|city|board of license commissioners|class [a-z]|licenses? quota|district)/,
    'manufacturing-sales': /\b(brewer|winer|distiller|manufactur|delivery|statewide|wholesal)/,
  },
  'cannabis-gaming': {
    'cannabis': /\b(cannabis|marijuana|dispensar|psychedelic|psilocybin)/,
    'gaming-wagering': /\b(wagering|gaming|lottery|casinos?|bingo|raffles?|video lottery)/,
    'horse-racing': /\b(horse|racing|racetrack|purses?)/,
  },
  'government-admin': {
    'elections': /\b(elections?|voters?|voting|ballots?|campaign|candidates?|redistricting|election districts)/,
    'budget-finance': /\b(state debt|budget|appropriations?|bond|capital|board of public works|treasurer|investment)/,
    'procurement': /\b(procurement|contracts?|bidders?|offerors?)/,
    'personnel-pensions': /\b(personnel|state employees?|pension|retirement|leave)/,
    'agencies-ethics': /\b(ethics|public information|open meetings|commission|general assembly|designat|commemorat|officials?|agenc)/,
  },
  'local-government': {
    'county-governance': /\b(council|commissioners|charter|executive|salar|officials?|ethics|sheriff|ordinances?)/,
    'local-finance': /\b(bonds?|fees?|funds?|audit|finance|impact fees|revenue)/,
  },
};

// ── helpers ──────────────────────────────────────────────────────────────────
const COUNTY_RE = /^(the )?((allegany|anne arundel|baltimore|calvert|caroline|carroll|cecil|charles|dorchester|frederick|garrett|harford|howard|kent|montgomery|prince george['’]s|queen anne['’]s|st\.? mary['’]s|somerset|talbot|washington|wicomico|worcester)( county)?( and [a-z' ’.]+ count(y|ies))?|baltimore city|(city|town|village) of [a-z .'’]+|ocean city|annapolis|hagerstown|frederick city|tri-county council[a-z ]*)\b/i;
const LOCAL_CODE_RE = /\s+((pg|mc|pg\/mc|mc\/pg|ho\.? co\.?|b\.?c\.?)\s*[\d–-]+)\s*$/i;
const CEREMONIAL_RE = /\b(commemorative|awareness (day|week|month)|heritage month|appreciation (day|week|month)|state designations?|state (shark|bird|flower|dog|cat|reptile|insect|sport|beverage|dessert|symbol)|\bday\b$|\bmonth\b$|memorial (sign|highway|bridge|road)|memorials? -|in remembrance|honoring)/i;
const PROCEDURAL_RE = /\b(sunset extension|sunset repeal|termination date|- membership\b|membership (alterations?|changes?)|technical corrections?|reporting requirements? - (alterations?|revisions?)|report(ing)? (date|deadline)|- study\b|study on|task force|workgroup|commission to study|correction of errors|clarifications?)\b/i;

function splitTitle(title) {
  return String(title || '')
    .replace(LOCAL_CODE_RE, '')
    .split(/\s+[-–—]\s+|\s*–\s*|\s*—\s*/)
    .map(s => s.trim()).filter(Boolean);
}

function headSegments(title) {
  const segs = splitTitle(title);
  let local = false;
  while (segs.length > 1 && COUNTY_RE.test(segs[0]) && segs[0].length < 70) {
    // "Baltimore County Board of Education - X" keeps its heading; plain
    // jurisdiction names are stripped so the policy heading comes first.
    if (/board of (education|school|license)|community college|sanitary|police|sheriff/i.test(segs[0])) break;
    local = true; segs.shift();
  }
  return { segs, local };
}

function subjectNames(subjects) {
  return (subjects || []).map(s => (typeof s === 'string' ? s : (s.subject_name || s.subject || ''))).filter(Boolean);
}

export function significanceOf({ title, subjects, local }) {
  const t = String(title || '');
  const names = subjectNames(subjects);
  if (CEREMONIAL_RE.test(t) || /Holidays and Special Dates/.test(names.slice(0, 4).join('|')) && /\b(day|week|month|designat)/i.test(t)) return 'ceremonial';
  const isLocal = local ?? (COUNTY_RE.test(t) || LOCAL_CODE_RE.test(t));
  if (isLocal || names.some(n => /- Local Bills$|^Counties - Local Laws$|^Alcoholic Beverages - By Subdivision$/.test(n)) && !/statewide/i.test(names[0] || '')) return 'local';
  if (PROCEDURAL_RE.test(t)) return 'procedural';
  return 'substantive';
}

// ── main entry point ─────────────────────────────────────────────────────────
// bill: { title, description?, subjects? (strings or {subject_name}) }
// returns { topic, subtopic, secondary, confidence, score, margin,
//           significance, evidence: [..], scores: {topic: n} }
export function classifyBill(bill) {
  const title = String(bill.title || '');
  const desc = String(bill.description || '');
  const names = subjectNames(bill.subjects);
  const { segs, local } = headSegments(title);
  const tLow = title.toLowerCase();
  const dLow = desc.toLowerCase();

  const scores = {};
  const subVotes = {};       // topic -> sub -> weight
  const evidence = [];
  const add = (topic, w, why, sub = null) => {
    if (!topic || !w) return;
    scores[topic] = (scores[topic] || 0) + w;
    if (sub) ((subVotes[topic] ||= {})[sub] = (subVotes[topic][sub] || 0) + w);
    evidence.push([topic, +w.toFixed(2), why]);
  };

  // 1. title headings — check the first two segments, second one discounted
  const generic = segs.length > 1 && GENERIC_HEAD_RE.test(segs[0].toLowerCase());
  segs.slice(0, 2).forEach((seg, i) => {
    const s = seg.toLowerCase();
    const f = i === 0 ? (generic ? 0.6 : 1) : (generic ? 1 : 0.55);
    for (const [re, topic, sub, w] of TITLE_HEADS) {
      if (re.test(s)) { add(topic, w * f, `title heading “${seg}”`, sub); break; }
    }
  });
  // Pay and terms of a single county's officials are local-government matters.
  if (local && /\b(salar(y|ies)|compensation)\b/i.test(title)) add('local-government', 6, 'local officials\u2019 pay', 'county-governance');

  // 2. subjects by position
  names.forEach((n, i) => {
    const m = SUBJECTS[n]; if (!m) return;
    const base = i === 0 ? 5 : i === 1 ? 2.5 : i === 2 ? 1.2 : 0.8;
    add(m[0], base * m[2], `subject “${n}”`, m[1]);
  });

  // 3. keywords
  for (const [topic, rules] of Object.entries(KEYWORDS)) {
    for (const [re, tw, dw] of rules) {
      if (re.test(tLow)) add(topic, tw, 'title keyword');
      else if (re.test(dLow)) add(topic, dw, 'summary keyword');
    }
  }

  // 4. pick primary / secondary
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (!ranked.length) {
    return { topic: null, subtopic: null, secondary: null, confidence: 'low', score: 0, margin: 0,
      significance: significanceOf({ title, subjects: names, local }), evidence, scores, version: CLASSIFIER_VERSION };
  }
  let [topic, best] = ranked[0];
  let runnerUp = ranked[1] || [null, 0];

  // Commemorative days/months and state symbols are filed as State Government,
  // but a lobbyist cares what they are ABOUT ("Climate Education Month"). If
  // the title itself names a policy area, use it; significance stays
  // ceremonial so these barely move anyone's score.
  const significance = significanceOf({ title, subjects: names, local });
  if (significance === 'ceremonial' && topic === 'government-admin') {
    const titled = evidence.filter(e => e[2] === 'title keyword' && e[0] !== 'government-admin')
      .sort((a, b) => (scores[b[0]] || 0) - (scores[a[0]] || 0))[0];
    if (titled) { runnerUp = [topic, best]; topic = titled[0]; best = scores[topic]; evidence.push([topic, 0, 'commemorative — classified by subject']); }
  }

  // A local bill whose only real signal is "it's local" stays local-government;
  // anything with substance goes to its policy area (the significance flag
  // still records that it is local).
  // Secondary: a clear runner-up, OR a smaller one the TITLE itself points at
  // ("Income Tax – Credit for Employers of Apprentices" → +workforce).
  let secondary = null;
  const titleBacked = t => evidence.some(e => e[0] === t && /^title/.test(e[2]));
  for (const [t, v] of ranked.slice(1, 4)) {
    if (t === topic) continue;
    if (v >= Math.max(4, best * 0.45) || (v >= 4 && v >= best * 0.25 && titleBacked(t))) { secondary = t; break; }
  }

  // 5. subtopic within the primary topic
  let subtopic = null;
  const subs = SUBTOPIC_CODES[topic] || [];
  if (subs.length) {
    const sv = { ...(subVotes[topic] || {}) };
    const kw = SUB_KEYWORDS[topic] || {};
    const subjLow = names.join(' | ').toLowerCase();
    // the specific tail of the title ("… – Bullying – …") beats the heading
    const tail = segs.slice(1).join(' | ').toLowerCase() || tLow;
    for (const k of Object.keys(sv)) sv[k] *= 0.5;      // heading/subject votes, softened
    for (const [code, re] of Object.entries(kw)) {
      if (re.test(tail)) sv[code] = (sv[code] || 0) + 3.5;
      else if (re.test(tLow)) sv[code] = (sv[code] || 0) + 1.5;
      if (re.test(dLow)) sv[code] = (sv[code] || 0) + 1.2;
      if (re.test(subjLow)) sv[code] = (sv[code] || 0) + 0.6;
    }
    const top = Object.entries(sv).filter(([c]) => subs.includes(c)).sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] >= 2) subtopic = top[0];
  }

  const margin = best - runnerUp[1];
  const ratio = runnerUp[1] ? best / runnerUp[1] : Infinity;
  const confidence = best >= 9 && ratio >= 1.6 ? 'high' : best >= 5 && ratio >= 1.2 ? 'medium' : 'low';

  return {
    topic, subtopic, secondary, confidence,
    score: +best.toFixed(2), margin: +margin.toFixed(2),
    significance,
    evidence: evidence.filter(e => e[0] === topic || e[0] === secondary).sort((a, b) => b[1] - a[1]).slice(0, 6),
    scores: Object.fromEntries(ranked.slice(0, 5).map(([k, v]) => [k, +v.toFixed(2)])),
    version: CLASSIFIER_VERSION,
  };
}

// Convenience for the Proposer: free text in, ranked topic guesses out.
export function classifyText(text) {
  const r = classifyBill({ title: text, description: text });
  return r;
}

export function topicLabel(code) { return TOPIC_BY_CODE[code]?.label || code; }
