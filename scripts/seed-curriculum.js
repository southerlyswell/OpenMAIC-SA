#!/usr/bin/env node
/**
 * Seed the SQLite database with CAPS curriculum data.
 *
 * Usage: node scripts/seed-curriculum.js
 * Run from project root: cd /home/patrick/OpenMAIC && node scripts/seed-curriculum.js
 */

const path = require("node:path");
const Database = require("better-sqlite3");

const DB_PATH = path.join(__dirname, "..", "data", "maic.db");
const SEED_PATH = path.join(__dirname, "..", "data", "curriculum.json");

console.log(`Seeding curriculum into ${DB_PATH}`);

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Read seed data
const seed = JSON.parse(require("node:fs").readFileSync(SEED_PATH, "utf-8"));

// Count before
const before = {
  phases: db.prepare("SELECT COUNT(*) as c FROM phases").get().c,
  subjects: db.prepare("SELECT COUNT(*) as c FROM subjects").get().c,
  topics: db.prepare("SELECT COUNT(*) as c FROM topics").get().c,
};

console.log("Before:", before);

// Insert phases
const insertPhase = db.prepare(
  "INSERT OR IGNORE INTO phases (id, name, grades) VALUES (?, ?, ?)"
);
// Insert subjects
const insertSubject = db.prepare(
  "INSERT OR IGNORE INTO subjects (id, phase_id, name, grade, caps_document_url) VALUES (?, ?, ?, ?, ?)"
);
// Insert topics
const insertTopic = db.prepare(
  "INSERT OR IGNORE INTO topics (id, subject_id, title, caps_code, sequence, learning_outcomes) VALUES (?, ?, ?, ?, ?, ?)"
);

const transaction = db.transaction(() => {
  for (const phase of seed.phases) {
    insertPhase.run(phase.id, phase.name, phase.grades);
  }
  console.log(`  Inserted ${seed.phases.length} phases`);

  for (const subject of seed.subjects) {
    insertSubject.run(
      subject.id,
      subject.phase_id,
      subject.name,
      subject.grade,
      subject.caps_document_url
    );
  }
  console.log(`  Inserted ${seed.subjects.length} subjects`);

  for (const topic of seed.topics) {
    insertTopic.run(
      topic.id,
      topic.subject_id,
      topic.title,
      topic.caps_code,
      topic.sequence,
      topic.learning_outcomes
    );
  }
  console.log(`  Inserted ${seed.topics.length} topics`);
});

transaction();

// Count after
const after = {
  phases: db.prepare("SELECT COUNT(*) as c FROM phases").get().c,
  subjects: db.prepare("SELECT COUNT(*) as c FROM subjects").get().c,
  topics: db.prepare("SELECT COUNT(*) as c FROM topics").get().c,
};
console.log("After:", after);
console.log("New rows:", {
  phases: after.phases - before.phases,
  subjects: after.subjects - before.subjects,
  topics: after.topics - before.topics,
});

db.close();
console.log("\nSeed complete! Run the server and check /api/courses");
