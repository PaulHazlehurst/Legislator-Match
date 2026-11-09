import { TOPICS } from '../../shared/taxonomy.js';

// Upsert every topic + subtopic in shared/taxonomy.js. Returns counts.
export async function seedTaxonomy(db, { log = console.log } = {}) {
  let topics = 0, subtopics = 0;
  for (const t of TOPICS) {
    const { data: topic, error } = await db.from('topics').upsert({
      code: t.code, label: t.label,
      guidance_includes: t.includes, guidance_excludes: t.excludes,
    }, { onConflict: 'code' }).select('id').single();
    if (error) { log(`  topic error ${t.code}: ${error.message}`); continue; }
    topics++;
    for (const [code, label, guidance] of t.subtopics) {
      const { error: sErr } = await db.from('subtopics').upsert(
        { topic_id: topic.id, code, label, guidance }, { onConflict: 'topic_id,code' });
      if (sErr) log(`  subtopic error ${t.code}/${code}: ${sErr.message}`); else subtopics++;
    }
  }
  return { topics, subtopics };
}
