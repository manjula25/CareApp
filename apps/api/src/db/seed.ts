import Database from 'better-sqlite3';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { getDb } from './index';

export const DEMO_PASSWORD = 'Demo1234!';

const DEMO_USERS = [
  { email: 'director@caresync.demo', name: 'Dana Director', role: 'director' },
  { email: 'coordinator@caresync.demo', name: 'Cara Coordinator', role: 'coordinator' },
  { email: 'socialworker@caresync.demo', name: 'Sam Socialworker', role: 'social_worker' },
] as const;

export function seedDemoUsers(db: Database.Database): void {
  const passwordHash = bcrypt.hashSync(DEMO_PASSWORD, 10);
  const upsert = db.prepare(`
    INSERT INTO users (id, email, password_hash, name, role)
    VALUES (@id, @email, @password_hash, @name, @role)
    ON CONFLICT(email) DO UPDATE SET
      password_hash = excluded.password_hash,
      name = excluded.name,
      role = excluded.role
  `);

  for (const user of DEMO_USERS) {
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(user.email) as { id: string } | undefined;
    upsert.run({
      id: existing?.id ?? crypto.randomUUID(),
      email: user.email,
      password_hash: passwordHash,
      name: user.name,
      role: user.role,
    });
  }
}

if (require.main === module) {
  seedDemoUsers(getDb());
  console.log('Seeded demo accounts for director, coordinator, and social_worker.');
}
