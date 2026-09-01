// ─────────────────────────────────────────────────────────────────────────────
// TAXONOMY — the single source of truth for classification.
//
// REVIEW THIS FILE. Everything downstream (scoring, filtering, matching) is only
// as good as these categories. It's derived from your old data.json topics,
// cleaned up, with real guidance added. Adjust labels, add/remove subtopics,
// and tighten guidance to match how your firm actually thinks about issues.
//
// Rules the classifier obeys:
//   • It may only choose a topic from this list, or return null.
//   • It may only choose a subtopic that belongs to the topic it picked.
//   • "includes"/"excludes" are given to the model verbatim as decision rules.
//   • subjectMap lets official LegiScan subject tags set the topic directly,
//     with NO AI call — this is the most accurate path, used first.
// ─────────────────────────────────────────────────────────────────────────────

export const TOPICS = [
  {
    code: 'environment', label: 'Environment & Natural Resources',
    includes: 'clean/renewable energy, conservation, water/air quality, emissions, waste, wildlife, Chesapeake Bay, forestry, climate',
    excludes: 'energy TAXATION (→taxation), building codes unrelated to energy (→construction), agricultural business regulation (→business-regulation)',
    subtopics: [
      ['clean-energy', 'Clean & renewable energy', 'solar, wind, storage, grid, RPS'],
      ['conservation', 'Conservation & wildlife', 'land preservation, oysters, forests, habitat'],
      ['waste-pollution', 'Waste & pollution', 'PFAS, recycling, emissions, hazardous materials'],
      ['water', 'Water resources', 'Chesapeake Bay, stormwater, drinking water'],
    ],
  },
  {
    code: 'taxation', label: 'Taxation & Revenue',
    includes: 'income/sales/property tax, tax credits and exemptions, tax rates, revenue and fees imposed as taxes',
    excludes: 'general appropriations/budget process (→government-administration), business licensing fees (→business-regulation)',
    subtopics: [
      ['income-tax', 'Income tax', 'individual and corporate income tax'],
      ['sales-use-tax', 'Sales & use tax', 'sales tax, exemptions'],
      ['property-tax', 'Property tax', 'assessments, property tax credits'],
      ['credits-incentives', 'Credits & incentives', 'tax credits, economic incentives, exemptions'],
    ],
  },
  {
    code: 'education', label: 'Education',
    includes: 'K-12 and higher ed funding, curriculum, school operations, teachers, students, school safety policy',
    excludes: 'workforce training programs outside schools (→workforce), child protection criminal matters (→public-safety)',
    subtopics: [
      ['k12-funding', 'K-12 funding', 'school funding formulas, per-pupil, grants'],
      ['higher-ed', 'Higher education', 'colleges, universities, tuition, scholarships'],
      ['curriculum-policy', 'Curriculum & school policy', 'standards, start times, device policy'],
      ['school-safety', 'School health & safety', 'school safety, health requirements'],
    ],
  },
  {
    code: 'public-safety', label: 'Public Safety & Criminal Justice',
    includes: 'criminal law, sentencing, policing, corrections, courts, expungement, juvenile justice, victims',
    excludes: 'firearms regulation specifically (→firearms), traffic/vehicle law (→transportation)',
    subtopics: [
      ['criminal-law', 'Criminal law & sentencing', 'offenses, penalties, sentencing'],
      ['policing-corrections', 'Policing & corrections', 'police, prisons, parole, probation'],
      ['expungement', 'Expungement & records', 'record clearing, clean slate'],
      ['juvenile', 'Juvenile justice', 'juvenile offenders, youth services'],
      ['child-protection', 'Child protection', 'abuse, exploitation, child safety offenses'],
    ],
  },
  {
    code: 'firearms', label: 'Firearms & Weapons',
    includes: 'gun regulation, permits, waiting periods, prohibited persons, weapon types',
    excludes: 'general violent-crime penalties not specific to firearms (→public-safety)',
    subtopics: [
      ['purchase-permitting', 'Purchase & permitting', 'waiting periods, background checks, permits'],
      ['possession-carry', 'Possession & carry', 'carry laws, prohibited persons/places'],
    ],
  },
  {
    code: 'labor-employment', label: 'Labor & Employment',
    includes: 'wages, workplace safety, collective bargaining, unemployment, employment discrimination, leave',
    excludes: 'workforce training/apprenticeship programs (→workforce), professional licensing (→business-regulation)',
    subtopics: [
      ['wages', 'Wages & hours', 'minimum wage, prevailing wage, overtime'],
      ['workplace-safety', 'Workplace safety', 'OSHA, heat stress, conditions'],
      ['labor-relations', 'Labor relations', 'unions, collective bargaining'],
      ['discrimination-leave', 'Discrimination & leave', 'employment discrimination, paid leave'],
    ],
  },
  {
    code: 'workforce', label: 'Workforce Development',
    includes: 'job training, apprenticeships, employer hiring incentives, skills programs, reentry workforce',
    excludes: 'K-12/higher ed (→education), wage/labor law (→labor-employment)',
    subtopics: [
      ['training-apprenticeship', 'Training & apprenticeship', 'job training, apprenticeships'],
      ['employer-incentives', 'Employer incentives', 'hiring incentives, workforce grants'],
    ],
  },
  {
    code: 'health', label: 'Health & Human Services',
    includes: 'public health, Medicaid, health insurance mandates, hospitals, behavioral health, drugs/medical devices, social services',
    excludes: 'health-related taxation (→taxation), workplace health/safety (→labor-employment)',
    subtopics: [
      ['public-health', 'Public health', 'disease, prevention, health programs'],
      ['behavioral-health', 'Behavioral & mental health', 'mental health, substance use'],
      ['insurance-coverage', 'Insurance & coverage', 'health insurance mandates, Medicaid'],
      ['human-services', 'Human & social services', 'benefits, aging, disability services'],
    ],
  },
  {
    code: 'business-regulation', label: 'Business & Professional Regulation',
    includes: 'professional/occupational licensing, business permits, industry-specific regulation, consumer-facing business rules',
    excludes: 'business taxation (→taxation), labor/employment rules (→labor-employment)',
    subtopics: [
      ['licensing', 'Licensing & permits', 'occupational and professional licensure'],
      ['industry-regulation', 'Industry regulation', 'sector-specific rules and oversight'],
    ],
  },
  {
    code: 'consumer-protection', label: 'Consumer Protection',
    includes: 'consumer fraud, product safety, advertising, warranties, data/privacy, unfair practices',
    excludes: 'financial-institution regulation as an industry (→business-regulation)',
    subtopics: [
      ['fraud-practices', 'Fraud & unfair practices', 'deceptive practices, scams'],
      ['product-privacy', 'Product safety & privacy', 'product safety, data privacy, warranties'],
    ],
  },
  {
    code: 'land-use-property', label: 'Land Use & Property Rights',
    includes: 'zoning, land use, real property, landlord/tenant, short-term rentals, eminent domain, surveying',
    excludes: 'property TAXATION (→taxation), environmental land conservation (→environment)',
    subtopics: [
      ['zoning-development', 'Zoning & development', 'zoning, planning, development'],
      ['landlord-tenant', 'Landlord & tenant', 'rentals, tenant rights, short-term rentals'],
    ],
  },
  {
    code: 'transportation', label: 'Transportation & Motor Vehicles',
    includes: 'roads, transit, vehicle law, licensing/registration, traffic safety, speed limits',
    excludes: 'transportation funding via taxes (→taxation)',
    subtopics: [
      ['roads-transit', 'Roads & transit', 'highways, public transit, infrastructure'],
      ['vehicle-law', 'Vehicle & traffic law', 'registration, licensing, traffic safety'],
    ],
  },
  {
    code: 'alcohol-licensing', label: 'Alcoholic Beverages & Licensing',
    includes: 'alcohol licenses, permits, local beverage boards, distillery/brewery rules',
    excludes: 'alcohol taxation (→taxation)',
    subtopics: [
      ['licenses', 'Licenses & permits', 'class licenses, local boards'],
    ],
  },
  {
    code: 'government-admin', label: 'Government Administration & Elections',
    includes: 'state agency operations, procurement, budget/appropriations process, elections, voter registration, public records',
    excludes: 'taxation (→taxation), criminal election offenses (→public-safety)',
    subtopics: [
      ['agency-operations', 'Agency operations', 'agencies, procurement, IT, reporting'],
      ['budget-appropriations', 'Budget & appropriations', 'appropriations, state finance'],
      ['elections', 'Elections & voting', 'voter registration, election administration'],
    ],
  },
  {
    code: 'veterans-military', label: 'Veterans & Military Affairs',
    includes: 'veterans benefits and services, military affairs, veteran-specific programs',
    excludes: 'a bill that merely mentions veterans as a population but is really about tax, health, or housing — classify by what it DOES',
    subtopics: [],
  },
];

// LegiScan subject_name → our topic code. First and most accurate path.
// Extend this as you see which subjects LegiScan actually tags MD bills with.
export const SUBJECT_TO_TOPIC = {
  'Energy': 'environment',
  'Environment': 'environment',
  'Natural Resources': 'environment',
  'Water': 'environment',
  'Taxation': 'taxation',
  'Taxes': 'taxation',
  'Revenue': 'taxation',
  'Education': 'education',
  'Schools': 'education',
  'Crimes': 'public-safety',
  'Criminal Justice': 'public-safety',
  'Courts': 'public-safety',
  'Corrections': 'public-safety',
  'Firearms': 'firearms',
  'Weapons': 'firearms',
  'Labor': 'labor-employment',
  'Employment': 'labor-employment',
  'Wages': 'labor-employment',
  'Health': 'health',
  'Public Health': 'health',
  'Medicaid': 'health',
  'Insurance': 'health',
  'Business': 'business-regulation',
  'Professions': 'business-regulation',
  'Licenses': 'business-regulation',
  'Consumer Protection': 'consumer-protection',
  'Real Property': 'land-use-property',
  'Land Use': 'land-use-property',
  'Housing': 'land-use-property',
  'Zoning': 'land-use-property',
  'Transportation': 'transportation',
  'Motor Vehicles': 'transportation',
  'Alcoholic Beverages': 'alcohol-licensing',
  'Elections': 'government-admin',
  'State Government': 'government-admin',
  'Government': 'government-admin',
  'Procurement': 'government-admin',
  'Veterans': 'veterans-military',
  'Military': 'veterans-military',
};

// Party control of both MD chambers for the sessions we're loading.
// Maryland House and Senate were Democratic-majority throughout 2024–2026.
export const SESSION_CONTROL = {
  house: 'D',
  senate: 'D',
};
