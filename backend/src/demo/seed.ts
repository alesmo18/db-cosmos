/**
 * Demo database: in-memory SQLite with a StackOverflow-inspired schema.
 * Tables: users, questions, answers, comments, tags, question_tags, votes, badges, user_badges
 * Run `seedDemo(db)` after opening the connection to populate it.
 */
import type Database from 'better-sqlite3';

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  reputation INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  question_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  score INTEGER DEFAULT 0,
  view_count INTEGER DEFAULT 0,
  answer_count INTEGER DEFAULT 0,
  accepted_answer_id INTEGER,
  created_at INTEGER DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id INTEGER NOT NULL REFERENCES questions(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  score INTEGER DEFAULT 0,
  is_accepted INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  post_type TEXT NOT NULL CHECK(post_type IN ('question','answer')),
  user_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  score INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS question_tags (
  question_id INTEGER NOT NULL REFERENCES questions(id),
  tag_id INTEGER NOT NULL REFERENCES tags(id),
  PRIMARY KEY (question_id, tag_id)
);

CREATE TABLE IF NOT EXISTS votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  post_type TEXT NOT NULL CHECK(post_type IN ('question','answer')),
  user_id INTEGER NOT NULL REFERENCES users(id),
  vote_type INTEGER NOT NULL CHECK(vote_type IN (1,-1)),
  created_at INTEGER DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS badges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  badge_class TEXT NOT NULL CHECK(badge_class IN ('gold','silver','bronze'))
);

CREATE TABLE IF NOT EXISTS user_badges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  badge_id INTEGER NOT NULL REFERENCES badges(id),
  awarded_at INTEGER DEFAULT (strftime('%s','now'))
);
`;

const USERS = [
  ['alice', 'alice@example.com', 4520],
  ['bob', 'bob@example.com', 1203],
  ['carol', 'carol@example.com', 8801],
  ['dave', 'dave@example.com', 320],
  ['eve', 'eve@example.com', 12050],
  ['frank', 'frank@example.com', 550],
  ['grace', 'grace@example.com', 2200],
  ['hank', 'hank@example.com', 88],
];

const TAGS = [
  ['javascript', 'JS questions', 42000],
  ['python', 'Python questions', 38000],
  ['sql', 'SQL and databases', 29000],
  ['typescript', 'TypeScript', 15000],
  ['react', 'React framework', 21000],
  ['node.js', 'Node.js runtime', 18000],
  ['css', 'Cascading Style Sheets', 31000],
  ['docker', 'Containerization', 9000],
];

const BADGES = [
  ['Great Answer', 'Answer with score > 100', 'gold'],
  ['Nice Question', 'Question with score > 10', 'silver'],
  ['Student', 'Asked first question', 'bronze'],
  ['Teacher', 'Answered first question', 'bronze'],
  ['Enlightened', 'First accepted answer with score > 10', 'silver'],
];

export function seedDemo(db: Database.Database): void {
  db.exec(SCHEMA);

  const userInsert = db.prepare(
    'INSERT OR IGNORE INTO users (username, email, reputation) VALUES (?, ?, ?)'
  );
  const tagInsert = db.prepare(
    'INSERT OR IGNORE INTO tags (name, description, question_count) VALUES (?, ?, ?)'
  );
  const badgeInsert = db.prepare(
    'INSERT OR IGNORE INTO badges (name, description, badge_class) VALUES (?, ?, ?)'
  );

  const insertMany = db.transaction((items: unknown[][], stmt: Database.Statement) => {
    for (const row of items) stmt.run(...row);
  });

  insertMany(USERS, userInsert);
  insertMany(TAGS, tagInsert);
  insertMany(BADGES, badgeInsert);

  // Seed questions, answers, votes etc only if empty
  const count = (db.prepare('SELECT COUNT(*) as c FROM questions').get() as { c: number }).c;
  if (count > 0) return;

  const qInsert = db.prepare(
    'INSERT INTO questions (user_id, title, body, score, view_count, answer_count) VALUES (?,?,?,?,?,?)'
  );
  const aInsert = db.prepare(
    'INSERT INTO answers (question_id, user_id, body, score, is_accepted) VALUES (?,?,?,?,?)'
  );
  const qtInsert = db.prepare(
    'INSERT OR IGNORE INTO question_tags (question_id, tag_id) VALUES (?,?)'
  );
  const vInsert = db.prepare(
    'INSERT INTO votes (post_id, post_type, user_id, vote_type) VALUES (?,?,?,?)'
  );
  const ubInsert = db.prepare(
    'INSERT INTO user_badges (user_id, badge_id) VALUES (?,?)'
  );
  const cInsert = db.prepare(
    'INSERT INTO comments (post_id, post_type, user_id, body) VALUES (?,?,?,?)'
  );

  const seedAll = db.transaction(() => {
    const questionTitles = [
      'How to reverse a string in Python?',
      'Difference between == and === in JavaScript',
      'How to center a div in CSS?',
      'What is a Promise in JavaScript?',
      'How to use async/await with TypeScript?',
      'JOIN vs subquery performance in PostgreSQL',
      'How to run Docker in production?',
      'React useState vs useReducer',
      'How to write efficient SQL queries',
      'Node.js event loop explained',
      'TypeScript generics tutorial',
      'CSS Grid vs Flexbox',
    ];

    for (let i = 0; i < questionTitles.length; i++) {
      const userId = (i % USERS.length) + 1;
      const info = qInsert.run(userId, questionTitles[i], `Body of question ${i + 1}`, i * 3, i * 50 + 10, 2);
      const qId = Number(info.lastInsertRowid);

      qtInsert.run(qId, (i % TAGS.length) + 1);
      if (i % 3 === 0) qtInsert.run(qId, ((i + 2) % TAGS.length) + 1);

      // Two answers per question
      for (let j = 0; j < 2; j++) {
        const aUserId = ((userId + j) % USERS.length) + 1;
        const aInfo = aInsert.run(qId, aUserId, `Answer ${j + 1} to question ${i + 1}`, j * 5, j === 0 ? 1 : 0);
        const aId = Number(aInfo.lastInsertRowid);

        // A few votes
        for (let v = 0; v < 3; v++) {
          const vUser = (v % USERS.length) + 1;
          if (vUser !== aUserId) {
            try { vInsert.run(aId, 'answer', vUser, 1); } catch { /* ignore dup */ }
          }
        }

        cInsert.run(aId, 'answer', ((aUserId) % USERS.length) + 1, `Good point! (comment ${j + 1})`);
      }

      vInsert.run(qId, 'question', ((userId + 1) % USERS.length) + 1, 1);
      cInsert.run(qId, 'question', ((userId + 2) % USERS.length) + 1, 'Great question!');
    }

    // Award some badges
    ubInsert.run(1, 1);
    ubInsert.run(2, 3);
    ubInsert.run(3, 4);
    ubInsert.run(5, 2);
  });

  seedAll();
}

/** Demo activity tables — chosen with higher probability to simulate hot tables */
export const DEMO_HOT_TABLES = ['questions', 'answers', 'votes', 'comments'];
export const DEMO_COLD_TABLES = ['users', 'tags', 'question_tags', 'badges', 'user_badges'];
export const DEMO_TABLES = [...DEMO_HOT_TABLES, ...DEMO_COLD_TABLES];
