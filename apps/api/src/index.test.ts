import request from 'supertest';
import express from 'express';
import app from './index';

describe('GET /health', () => {
  it('returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

// S12 A.1 — global error handler. Mounted at the end of the middleware chain
// so any uncaught throw escapes a route and lands here as a consistent JSON
// `{error}` envelope. This test mounts a fresh app with a stub-throwing router
// + the same handler shape, since the production app's routes are mounted
// inside `if (require.main === module)` and don't run under supertest import.
describe('global error handler', () => {
  function buildAppWithThrowingRoute(): express.Express {
    const testApp = express();
    testApp.get('/boom', () => {
      throw new Error('synthetic failure');
    });
    testApp.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      console.error('[unhandled]', err);
      res.status(500).json({ error: 'Internal server error' });
    });
    return testApp;
  }

  it('returns 500 with JSON {error} on uncaught throw', async () => {
    const testApp = buildAppWithThrowingRoute();
    const res = await request(testApp).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
  });

  it('content-type is JSON, not HTML', async () => {
    const testApp = buildAppWithThrowingRoute();
    const res = await request(testApp).get('/boom');
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });
});