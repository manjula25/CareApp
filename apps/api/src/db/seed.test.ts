import Database from 'better-sqlite3';
import bcrypt from 'bcrypt';
import { migrate } from './index';
import { seedDemoUsers, DEMO_PASSWORD } from './seed';

describe('seedDemoUsers', () => {
  it('creates one user per role with the demo password', () => {
    const db = new Database(':memory:');
    migrate(db);
    seedDemoUsers(db);

    const users = db.prepare('SELECT * FROM users ORDER BY role').all() as any[];
    expect(users.map((u) => u.role)).toEqual(['coordinator', 'director', 'social_worker']);
    for (const user of users) {
      expect(bcrypt.compareSync(DEMO_PASSWORD, user.password_hash)).toBe(true);
    }
  });

  it('is idempotent when run twice', () => {
    const db = new Database(':memory:');
    migrate(db);
    seedDemoUsers(db);
    seedDemoUsers(db);

    const count = (db.prepare('SELECT COUNT(*) as n FROM users').get() as any).n;
    expect(count).toBe(3);
  });
});
