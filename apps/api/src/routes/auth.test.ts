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

describe('GET /api/auth/me', () => {
  function setup() {
    const db = new Database(':memory:');
    migrate(db);
    seedDemoUsers(db);
    return { app: buildApp(db), db };
  }

  async function loginAndGetToken(email: string, password: string): Promise<string> {
    const res = await request(buildApp(new Database(':memory:')))
      .post('/api/auth/login')
      .send({ email, password });
    return res.body.token as string;
  }

  it('returns 401 without a bearer token', async () => {
    const { app } = setup();
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns the full user row + computed initials for a valid token', async () => {
    // Login via a separate seeded DB so we get a real token.
    const db = new Database(':memory:');
    migrate(db);
    seedDemoUsers(db);
    const loginRes = await request(buildApp(db))
      .post('/api/auth/login')
      .send({ email: 'coordinator@caresync.demo', password: DEMO_PASSWORD });
    const token = loginRes.body.token as string;

    const res = await request(buildApp(db)).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: 'Cara Coordinator',
      email: 'coordinator@caresync.demo',
      role: 'coordinator',
    });
    expect(res.body.id).toEqual(expect.any(String));
    expect(res.body.initials).toBe('CC');
  });

  it('returns 401 when the token is malformed', async () => {
    const { app } = setup();
    const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer not-a-real-jwt');
    expect(res.status).toBe(401);
  });
});
