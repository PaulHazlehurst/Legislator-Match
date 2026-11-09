// The taxonomy lives in ../shared/taxonomy.js so the browser app and this
// pipeline can never drift apart. This file re-exports it for older scripts.
export { TOPICS, TOPIC_CODES, TOPIC_BY_CODE, SUBTOPIC_CODES, SESSION_CONTROL, TAXONOMY_VERSION } from '../shared/taxonomy.js';
