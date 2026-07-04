import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

export function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('director', 'coordinator', 'social_worker'))
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      fhir_resource TEXT NOT NULL,
      outcome TEXT NOT NULL CHECK (outcome IN ('success', 'denied', 'error'))
    );
  `);
}

let dbInstance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (dbInstance) return dbInstance;
  const dbPath = process.env.DB_PATH ?? path.join(__dirname, '../../data/caresync.sqlite');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  dbInstance = new Database(dbPath);
  migrate(dbInstance);
  return dbInstance;
}
