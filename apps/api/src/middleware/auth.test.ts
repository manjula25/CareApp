import express from 'express';
import request from 'supertest';
import { signToken } from '../auth/jwt';
import { requireAuth } from './auth';

function buildApp() {
  const app = express();
  app.get('/protected', requireAuth, (req, res) => {
    res.json({ role: req.auth?.role, id: req.auth?.id });
  });
  return app;
}

describe('requireAuth middleware', () => {
  it('rejects a request with no Authorization header', async () => {
    const res = await request(buildApp()).get('/protected');
    expect(res.status).toBe(401);
  });

  it('rejects an invalid token', async () => {
    const res = await request(buildApp()).get('/protected').set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
  });

  it('exposes req.auth.role for a valid token', async () => {
    const token = signToken({ id: 'user-1', name: 'Cara Coordinator', role: 'coordinator' });
    const res = await request(buildApp()).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ role: 'coordinator', id: 'user-1' });
  });
});
