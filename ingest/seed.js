import 'dotenv/config';
import { db } from './lib/db.js';
import { seedTaxonomy } from './lib/seedTaxonomy.js';

const STATE = process.env.STATE || 'MD';
const STATE_NAME = { MD: 'Maryland' }[STATE] || STATE;

async function main() {
  console.log(`Seeding state ${STATE} and taxonomy…`);
  await db.from('states').upsert({ code: STATE, name: STATE_NAME }, { onConflict: 'code' });
  const r = await seedTaxonomy(db);
  console.log(`Seed complete: ${r.topics} topics, ${r.subtopics} subtopics.`);
}

main().catch(e => { console.error(e); process.exit(1); });
