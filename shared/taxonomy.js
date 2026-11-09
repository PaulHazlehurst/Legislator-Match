// ─────────────────────────────────────────────────────────────────────────────
// TAXONOMY v2 — the single source of truth for bill classification.
//
// Shared by the browser app (shared/*.js are plain ES modules) and the ingest
// pipeline (ingest/*.js import from ../shared). Change a label here, re-run the
// "reclassify-all" workflow step, and every surface picks it up.
//
// Design rules
//   • Classify a bill by what it DOES, not who it mentions. A tax credit for
//     veterans is Taxation (secondary: Veterans); a hospital licensing bill is
//     Health even though it touches business regulation.
//   • Every bill gets ONE primary topic and at most one secondary topic.
//     Scoring counts secondary-topic bills at partial weight, so a solar tax
//     credit still surfaces energy champions.
//   • Topic codes from v1 are kept (nothing downstream breaks); v2 adds new
//     areas that previously had no home.
// ─────────────────────────────────────────────────────────────────────────────

export const TAXONOMY_VERSION = 2;

export const TOPICS = [
  {
    code: 'environment', label: 'Environment & Natural Resources',
    includes: 'conservation, wildlife, forests, parks, Chesapeake Bay and water quality, stormwater, air quality and emissions, climate policy, waste, recycling, pollution, PFAS, pesticides, fisheries, hunting, boating',
    excludes: 'electricity/gas utilities and renewable-energy procurement (→energy-utilities), farming (→agriculture), environmental TAXES (→taxation)',
    subtopics: [
      ['climate-air', 'Climate & air quality', 'greenhouse gas, emissions, climate goals, air permits'],
      ['water-bay', 'Water & the Bay', 'Chesapeake Bay, stormwater, drinking water, wetlands, critical area, shorelines'],
      ['waste-pollution', 'Waste, recycling & pollution', 'solid/hazardous waste, recycling, packaging, PFAS, toxics, pesticides, litter'],
      ['conservation-wildlife', 'Conservation, parks & wildlife', 'land preservation, forests, trees, parks, wildlife, Program Open Space'],
      ['fisheries-hunting', 'Fisheries, hunting & boating', 'oysters, crabs, fishing licenses, hunting, boating, waterways'],
    ],
  },
  {
    code: 'energy-utilities', label: 'Energy & Public Utilities',
    includes: 'electricity and natural gas, utility rates and the Public Service Commission, renewable portfolio standard, solar/wind/storage, energy efficiency and building energy standards, EV charging, water/sewer utilities',
    excludes: 'emissions rules not about energy supply (→environment), broadband/telecom (→technology-privacy)',
    subtopics: [
      ['renewable-energy', 'Renewable & clean energy', 'solar, offshore wind, storage, RPS, net metering, community solar'],
      ['utility-regulation', 'Utility rates & regulation', 'PSC, electric and gas companies, rates, ratepayer protections, gas infrastructure'],
      ['efficiency-buildings', 'Energy efficiency & buildings', 'EmPOWER, building energy performance, electrification, EV charging'],
      ['water-sewer', 'Water & sewer utilities', 'WSSC, water/sewer service, public water systems'],
    ],
  },
  {
    code: 'agriculture', label: 'Agriculture & Animals',
    includes: 'farming, agricultural land and operations, food production, farm products, hemp, animal welfare, veterinarians, pets and animal control',
    excludes: 'wildlife and hunting (→environment), agricultural land preservation easements (→environment), farm TAX credits (→taxation)',
    subtopics: [
      ['farming', 'Farming & food production', 'farms, crops, agricultural operations, farm products, food markets'],
      ['animal-welfare', 'Animal welfare', 'animal cruelty, pets, animal shelters, animal testing, veterinary practice'],
    ],
  },
  {
    code: 'taxation', label: 'Taxation & Revenue',
    includes: 'income, sales and use, property, estate, transfer, recordation, admissions and amusement, fuel taxes; tax credits, exemptions, subtraction modifications; tax administration',
    excludes: 'appropriations and the budget (→government-admin), regulatory license fees (→the regulated area)',
    subtopics: [
      ['income-tax', 'Income tax', 'individual and corporate income tax, subtraction modifications, EITC'],
      ['property-tax', 'Property tax', 'assessments, homestead credit, property tax credits and exemptions'],
      ['sales-use-tax', 'Sales & use tax', 'sales tax rates, exemptions, digital goods'],
      ['credits-incentives', 'Business tax credits & incentives', 'tax credits for businesses, enterprise zones, economic-development tax incentives'],
      ['other-taxes', 'Other taxes', 'estate, transfer, recordation, admissions, fuel, tobacco, local taxes'],
    ],
  },
  {
    code: 'education', label: 'Education',
    includes: 'K-12 public schools, Blueprint for Maryland\'s Future, school funding, curriculum, teachers and school staff, students, school boards, school construction, higher education, community colleges, financial aid, child care and early childhood',
    excludes: 'job training outside schools (→workforce), crimes against children (→public-safety)',
    subtopics: [
      ['k12-funding', 'K-12 funding & Blueprint', 'funding formulas, Blueprint, per-pupil aid, school construction funding'],
      ['curriculum-students', 'Curriculum & students', 'instruction, standards, testing, student health/safety, discipline, special education'],
      ['educators', 'Teachers & school staff', 'teacher certification, pay, retention, school personnel'],
      ['school-governance', 'School boards & operations', 'county boards of education, elections of board members, school operations'],
      ['higher-ed', 'Higher education', 'universities, community colleges, tuition, scholarships, MHEC'],
      ['early-childhood', 'Child care & early childhood', 'child care, pre-K, early learning, child care scholarships'],
    ],
  },
  {
    code: 'public-safety', label: 'Criminal Justice & Public Safety',
    includes: 'criminal law and penalties, criminal procedure, policing, corrections, parole and probation, reentry, juvenile justice, victims, expungement, domestic violence, emergency services and fire safety',
    excludes: 'firearms regulation (→firearms), traffic offenses and DUI (→transportation), civil lawsuits and family law (→family-civil-law)',
    subtopics: [
      ['criminal-law', 'Crimes & sentencing', 'new offenses, penalties, sentencing'],
      ['criminal-procedure', 'Criminal procedure & courts', 'warrants, evidence, pretrial release, criminal trials, wiretapping'],
      ['policing', 'Policing & law enforcement', 'police accountability, discipline, law enforcement agencies'],
      ['corrections-reentry', 'Corrections, parole & reentry', 'prisons, jails, parole, probation, reentry, correctional officers'],
      ['juvenile-justice', 'Juvenile justice', 'juvenile court, youth detention, minors charged as adults'],
      ['victims-records', 'Victims, expungement & records', 'victims\' rights, domestic violence protections, expungement, criminal records'],
      ['emergency-services', 'Emergency & fire services', 'EMS, 911, fire safety, emergency management'],
    ],
  },
  {
    code: 'firearms', label: 'Firearms & Weapons',
    includes: 'gun purchase, permits, carry, storage, prohibited persons and places, ghost guns, weapon types',
    excludes: 'general violent-crime penalties not specific to weapons (→public-safety)',
    subtopics: [
      ['purchase-permitting', 'Purchase & permitting', 'handgun qualification licenses, background checks, dealers'],
      ['possession-carry', 'Possession, carry & storage', 'carry permits, sensitive places, safe storage, prohibited persons, ghost guns'],
    ],
  },
  {
    code: 'family-civil-law', label: 'Family Law, Civil Justice & Courts',
    includes: 'divorce, custody, child support, adoption, guardianship, estates and trusts, civil lawsuits and liability, statutes of limitations, courts and judges, court administration, notaries',
    excludes: 'criminal cases (→public-safety), child-welfare services (→human-services)',
    subtopics: [
      ['family-law', 'Family law', 'divorce, custody, child support, adoption, marriage, guardianship'],
      ['civil-actions', 'Civil actions & liability', 'lawsuits, damages, immunity, statutes of limitations'],
      ['courts-judiciary', 'Courts & judiciary', 'judges, court operations, jurisdiction, court fees'],
      ['estates-trusts', 'Estates & trusts', 'wills, probate, trusts, powers of attorney'],
    ],
  },
  {
    code: 'labor-employment', label: 'Labor & Employment',
    includes: 'wages and hours, minimum wage, prevailing wage, workplace safety, workers\' compensation, unemployment insurance, paid leave, employment discrimination, unions and collective bargaining',
    excludes: 'job training (→workforce), professional licensing (→business-regulation or health), state pensions (→government-admin)',
    subtopics: [
      ['wages-hours', 'Wages & hours', 'minimum wage, prevailing wage, wage theft, scheduling'],
      ['workplace-safety-comp', 'Workplace safety & workers\' comp', 'occupational safety, heat stress, workers\' compensation'],
      ['labor-relations', 'Unions & collective bargaining', 'collective bargaining, public-employee unions'],
      ['leave-discrimination', 'Leave, benefits & discrimination', 'paid leave, FAMLI, unemployment insurance, employment discrimination'],
    ],
  },
  {
    code: 'workforce', label: 'Workforce Development',
    includes: 'job training, apprenticeships, career and technical education pathways, workforce grants, hiring incentives, reentry employment',
    excludes: 'wage/labor law (→labor-employment), school curriculum generally (→education)',
    subtopics: [
      ['training-apprenticeship', 'Training & apprenticeship', 'apprenticeships, job training, CTE pathways'],
      ['workforce-programs', 'Workforce programs & incentives', 'workforce grants, hiring incentives, workforce boards'],
    ],
  },
  {
    code: 'health', label: 'Health Care',
    includes: 'public health, hospitals and health facilities, health professions and boards, behavioral health and substance use, Medicaid, health insurance coverage mandates, prescription drugs and pharmacy, health care costs',
    excludes: 'social services, aging and disability services (→human-services), non-health insurance (→insurance-financial)',
    subtopics: [
      ['public-health', 'Public health', 'disease prevention, vaccines, tobacco/vaping, health programs, Department of Health'],
      ['behavioral-health', 'Behavioral health & substance use', 'mental health, addiction, overdose, crisis services'],
      ['health-insurance-medicaid', 'Health insurance & Medicaid', 'coverage mandates, Medicaid, the exchange, insurer practices'],
      ['facilities-providers', 'Hospitals & facilities', 'hospitals, nursing homes, certificate of need, HSCRC'],
      ['health-professions', 'Health professions', 'health occupation boards, licensure and scope of practice'],
      ['pharma-drugs', 'Prescription drugs & pharmacy', 'drug pricing, PBMs, pharmacies, prescription drug affordability'],
    ],
  },
  {
    code: 'human-services', label: 'Human Services, Aging & Disability',
    includes: 'social services, public assistance and SNAP, child welfare and foster care, aging services, disability services and accessibility, developmental disabilities, poverty and economic mobility programs',
    excludes: 'Medicaid and health coverage (→health), housing assistance (→housing)',
    subtopics: [
      ['assistance-benefits', 'Public assistance & benefits', 'SNAP, TCA, cash assistance, economic mobility'],
      ['child-welfare', 'Child welfare & foster care', 'foster care, child protective services, kinship care'],
      ['aging', 'Aging & seniors', 'senior services, Department of Aging, long-term supports'],
      ['disability', 'Disability & accessibility', 'disability services, developmental disabilities, accessibility'],
    ],
  },
  {
    code: 'insurance-financial', label: 'Insurance & Financial Services',
    includes: 'auto, homeowners, life, and other non-health insurance; insurance producers and regulation; banking, credit unions, lending, credit regulation, money transmission, commercial financing, cryptocurrency',
    excludes: 'health insurance coverage mandates (→health), consumer fraud generally (→consumer-protection)',
    subtopics: [
      ['insurance', 'Insurance (non-health)', 'auto, property, life, title insurance; producers; insurance administration'],
      ['banking-lending', 'Banking, lending & credit', 'banks, credit unions, consumer and commercial lending, credit regulation, fintech'],
    ],
  },
  {
    code: 'business-regulation', label: 'Business & Economic Development',
    includes: 'economic development programs, business incentives that are not taxes, corporations and business entities, commercial law, occupational and professional licensing (non-health), industry-specific regulation, procurement preferences for small/minority businesses',
    excludes: 'business TAXES (→taxation), labor law (→labor-employment), health professions (→health), alcohol (→alcohol-licensing)',
    subtopics: [
      ['economic-development', 'Economic development', 'Commerce, TEDCO, business incentive programs, enterprise funds'],
      ['professional-licensing', 'Professional & occupational licensing', 'boards for non-health occupations: real estate, cosmetology, contractors, accountants'],
      ['corporations-commercial', 'Corporations & commercial law', 'business entities, UCC, contracts, nonprofits'],
      ['industry-regulation', 'Industry regulation', 'sector-specific rules: tobacco retail, towing, motor vehicle dealers, etc.'],
      ['small-minority-business', 'Small & minority business', 'MBE program, small business reserve, minority business'],
    ],
  },
  {
    code: 'consumer-protection', label: 'Consumer Protection',
    includes: 'deceptive and unfair trade practices, product safety, warranties, debt collection, consumer contracts, pricing and fees disclosure, automatic renewals',
    excludes: 'data privacy and online platforms (→technology-privacy), banking regulation (→insurance-financial)',
    subtopics: [
      ['unfair-practices', 'Fraud & unfair practices', 'Consumer Protection Act, scams, deceptive practices, fees'],
      ['product-safety', 'Product safety & warranties', 'product safety, labeling, warranties, recalls'],
      ['debt-collection', 'Debt & collections', 'debt collection, medical debt, consumer credit reporting'],
    ],
  },
  {
    code: 'technology-privacy', label: 'Technology, Privacy & Telecom',
    includes: 'data privacy, online safety, social media, artificial intelligence, cybersecurity, broadband and telecommunications, state information technology, electronic records and signatures',
    excludes: 'wiretapping in criminal investigations (→public-safety)',
    subtopics: [
      ['data-privacy', 'Data privacy & online safety', 'consumer data privacy, children\'s online safety, social media'],
      ['ai-emerging-tech', 'AI & emerging technology', 'artificial intelligence, algorithms, deepfakes'],
      ['cybersecurity-it', 'Cybersecurity & government IT', 'cybersecurity, DoIT, state IT modernization'],
      ['broadband-telecom', 'Broadband & telecommunications', 'broadband, 5G, cable, telecom'],
    ],
  },
  {
    code: 'housing', label: 'Housing & Community Development',
    includes: 'landlord and tenant law, rent, eviction, affordable housing, homeownership, homelessness, condominiums and HOAs, Department of Housing and Community Development, community development',
    excludes: 'zoning and land use (→land-use-property), property TAXES (→taxation)',
    subtopics: [
      ['landlord-tenant', 'Landlord & tenant', 'leases, rent, eviction, tenant protections'],
      ['affordable-housing', 'Affordable housing & homelessness', 'housing programs, homelessness, DHCD, community development'],
      ['common-ownership', 'Condos & HOAs', 'condominiums, homeowners associations, cooperative housing'],
      ['homeownership', 'Homeownership & mortgages', 'homebuyers, foreclosure, mortgage assistance'],
    ],
  },
  {
    code: 'land-use-property', label: 'Land Use & Real Property',
    includes: 'zoning, planning, development, building codes, real property transactions and titles, eminent domain, surveying, real estate law',
    excludes: 'landlord-tenant and housing programs (→housing), property TAXES (→taxation), conservation easements (→environment)',
    subtopics: [
      ['zoning-planning', 'Zoning, planning & development', 'zoning, comprehensive plans, development, building codes'],
      ['real-property', 'Real property law', 'deeds, titles, sales, liens, easements, eminent domain'],
    ],
  },
  {
    code: 'transportation', label: 'Transportation & Motor Vehicles',
    includes: 'roads and highways, transit, MTA, rail, ports and airports, MDOT funding, tolls, vehicle registration and titling, driver licensing, traffic safety, rules of the road, DUI, speed cameras',
    excludes: 'auto INSURANCE (→insurance-financial), fuel TAXES (→taxation)',
    subtopics: [
      ['transit-infrastructure', 'Transit & infrastructure', 'highways, transit, rail, ports, airports, MDOT funding, tolls'],
      ['vehicle-law', 'Vehicles & licensing', 'registration, titles, license plates, driver licenses, MVA'],
      ['traffic-safety', 'Traffic safety & rules of the road', 'speed, cameras, DUI, pedestrians, cyclists, school buses'],
    ],
  },
  {
    code: 'alcohol-licensing', label: 'Alcoholic Beverages',
    includes: 'alcoholic beverage licenses and permits, local liquor boards, manufacturers (breweries, wineries, distilleries), sales and delivery rules',
    excludes: 'alcohol TAXES (→taxation), DUI (→transportation)',
    subtopics: [
      ['local-licenses', 'Local licenses & boards', 'county-specific license classes, liquor boards, hours'],
      ['manufacturing-sales', 'Manufacturers & statewide rules', 'breweries, wineries, distilleries, delivery, statewide sales rules'],
    ],
  },
  {
    code: 'cannabis-gaming', label: 'Cannabis, Gaming & Wagering',
    includes: 'cannabis regulation and licensing, medical cannabis, psychedelics, casinos, sports wagering, lottery, internet gaming, bingo and raffles, horse racing',
    excludes: 'cannabis-related criminal records only (→public-safety), gaming TAX rates alone (→taxation)',
    subtopics: [
      ['cannabis', 'Cannabis', 'adult-use and medical cannabis, dispensaries, Cannabis Administration, psychedelics'],
      ['gaming-wagering', 'Gaming, lottery & wagering', 'casinos, sports wagering, lottery, iGaming, bingo, raffles'],
      ['horse-racing', 'Horse racing', 'racetracks, Racing Commission, purses, breeding funds'],
    ],
  },
  {
    code: 'government-admin', label: 'State Government & Elections',
    includes: 'state agencies, budget and appropriations, state debt and bonds, procurement, state personnel and pensions, ethics, public information, open meetings, the General Assembly, constitutional amendments, elections, voting, campaign finance, redistricting, state designations',
    excludes: 'county-specific governance (→local-government), taxes (→taxation)',
    subtopics: [
      ['elections', 'Elections & campaign finance', 'voting, election administration, campaign finance, redistricting'],
      ['budget-finance', 'Budget, bonds & state finance', 'appropriations, capital bonds, state debt, Board of Public Works'],
      ['procurement', 'State procurement', 'procurement rules, contracts'],
      ['personnel-pensions', 'State personnel & pensions', 'state employees, retirement and pension systems'],
      ['agencies-ethics', 'Agencies, ethics & transparency', 'agency operations, ethics law, PIA, open meetings, General Assembly'],
    ],
  },
  {
    code: 'local-government', label: 'Local Government',
    includes: 'county and municipal governance, charters, local officials and salaries, local bonds and authorities, local codes, bills that apply to a single county or city and do not fit a policy area',
    excludes: 'a local bill whose substance is a policy area (e.g. a county alcohol license → alcohol-licensing, a county school board → education)',
    subtopics: [
      ['county-governance', 'County & municipal governance', 'charters, councils, local officials, salaries, ethics'],
      ['local-finance', 'Local finance & bonds', 'local bond authority, local fees, local funds'],
    ],
  },
  {
    code: 'veterans-military', label: 'Veterans & Military',
    includes: 'veterans\' benefits and services, military families, the National Guard, the Military Department',
    excludes: 'a bill that only names veterans as beneficiaries of a tax, health, or housing program — classify by what it does, with veterans as secondary',
    subtopics: [],
  },
];

export const TOPIC_CODES = TOPICS.map(t => t.code);
export const TOPIC_BY_CODE = Object.fromEntries(TOPICS.map(t => [t.code, t]));
export const SUBTOPIC_CODES = Object.fromEntries(TOPICS.map(t => [t.code, t.subtopics.map(s => s[0])]));

// Party control of each chamber, per session year. Maryland: Democratic
// majorities in both chambers throughout 2024–2026.
export const SESSION_CONTROL = { house: 'D', senate: 'D' };
