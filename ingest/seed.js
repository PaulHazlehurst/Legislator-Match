import 'dotenv/config';
import { db } from './lib/db.js';
import { TOPICS } from './taxonomy.js';

const STATE = process.env.STATE || 'MD';
const STATE_NAME = { MD: 'Maryland' }[STATE] || STATE;

async function main() {
  console.log(`Seeding state ${STATE} and taxonomy…`);

  // 1. state
  await db.from('states').upsert({ code: STATE, name: STATE_NAME }, { onConflict: 'code' });

  // 2. topics
  for (const t of TOPICS) {
    const { data: topic, error } = await db.from('topics').upsert({
      code: t.code, label: t.label,
      guidance_includes: t.includes, guidance_excludes: t.excludes,
    }, { onConflict: 'code' }).select('id').single();
    if (error) { console.error('topic error', t.code, error.message); continue; }

    // 3. subtopics for this topic
    for (const [code, label, guidance] of t.subtopics) {
      const { error: sErr } = await db.from('subtopics').upsert(
        { topic_id: topic.id, code, label, guidance },
        { onConflict: 'topic_id,code' }
      );
      if (sErr) console.error('  subtopic error', t.code, code, sErr.message);
    }
    console.log(`  ${t.code}: ${t.subtopics.length} subtopics`);
  }

  console.log('Seed complete.');
}

main().catch(e => { console.error(e); process.exit(1); });
