import express from 'express';
import Database from 'better-sqlite3';
import request from 'supertest';
import { migrate } from '../db';
import { seedDemoUsers, DEMO_PASSWORD } from '../db/seed';
import { verifyToken } from '../auth/jwt';
import { createAuthRouter } from './auth';

function buildApp(db: Database.Database) {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', createAuthRouter(db));
  return app;
}

describe('POST /api/auth/login', () => {
  function setup() {
    const db = new Database(':memory:');
    migrate(db);
    seedDemoUsers(db);
    return buildApp(db);
  }

  it('returns a JWT encoding the role for valid credentials', async () => {
    const res = await request(setup())
      .post('/api/auth/login')
      .send({ email: 'coordinator@caresync.demo', password: DEMO_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
    const payload = verifyToken(res.body.token);
    expect(payload.role).toBe('coordinator');
    expect(payload.name).toBe('Cara Coordinator');
  });

  it('rejects a bad password with 401', async () => {
    const res = await request(setup())
      .post('/api/auth/login')
      .send({ email: 'coordinator@caresync.demo', password: 'wrong-password' });
    expect(res.status).toBe(401);
  });

  it('rejects an unknown email with 401', async () => {
    const res = await request(setup())
      .post('/api/auth/login')
      .send({ email: 'nobody@caresync.demo', password: DEMO_PASSWORD });
    expect(res.status).toBe(401);
  });
});
