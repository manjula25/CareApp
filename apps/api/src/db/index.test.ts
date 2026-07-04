import Database from 'better-sqlite3';
import { migrate } from './index';

describe('migrate', () => {
  it('creates users and audit_log tables', () => {
    const db = new Database(':memory:');
    migrate(db);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((row: any) => row.name);

    expect(tables).toEqual(expect.arrayContaining(['users', 'audit_log']));
  });

  it('is idempotent when run twice', () => {
    const db = new Database(':memory:');
    migrate(db);
    expect(() => migrate(db)).not.toThrow();
  });
});
