import express from 'express';
import { AddressInfo } from 'net';
import { Server } from 'http';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { generateKeyPair, KeyPair } from '../smart/keys';
import { createTokenServer, verifyAccessToken } from '../smart/tokenServer';
import { SmartTokenClient } from '../smart/tokenClient';
import { createSmartAuthMiddleware, smartAuthErrorHandler } from './smartAuth';

// Default server secret exported by tokenServer — keep in sync with the
// token server used in setupTestEnv so signed tokens verify against the
// same HS256 key the middleware checks.
const DEFAULT_SERVER_SECRET = 'caresync-dev-authz-server-secret-do-not-use-in-production';

interface TestEnv {
  server: Server;
  tokenEndpoint: string;
  keys: KeyPair;
  /** Express app with the smartAuth middleware mounted + error handler. */
  buildApp(mwOptions?: Parameters<typeof createSmartAuthMiddleware>[0]): express.Express;
  /** Mint an access token via the in-process token server. */
  mintToken(scope?: string): Promise<string>;
  /** Mint an HS256 JWT directly with the middleware's server secret. */
  signDirect(payload: jwt.JwtPayload): string;
}

async function setupTestEnv(): Promise<TestEnv> {
  const keys = generateKeyPair();
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const port = (server.address() as AddressInfo).port;
  const tokenEndpoint = `http://localhost:${port}/smart/token`;
  app.use('/smart', createTokenServer({ clientId: 'caresync-api', tokenEndpoint, clientPublicKey: keys.publicKey }));

  return {
    server,
    tokenEndpoint,
    keys,
    buildApp(mwOptions = { serverSecret: DEFAULT_SERVER_SECRET }) {
      const a = express();
      a.get('/test', createSmartAuthMiddleware(mwOptions), (_req, res) => res.json({ ok: true }));
      a.post('/test', createSmartAuthMiddleware(mwOptions), (_req, res) => res.json({ ok: true }));
      // 404 fallthrough so we don't accidentally serve the default Express HTML
      // error page on a non-SMART middleware error.
      a.use(smartAuthErrorHandler);
      return a;
    },
    async mintToken(scope?: string): Promise<string> {
      const client = new SmartTokenClient({
        clientId: 'caresync-api',
        tokenEndpoint,
        privateKey: keys.privateKey,
        ...(scope ? { scope } : {}),
      });
      return client.getAccessToken();
    },
    signDirect(payload: jwt.JwtPayload): string {
      return jwt.sign(payload, DEFAULT_SERVER_SECRET, { algorithm: 'HS256', noTimestamp: true });
    },
  };
}

describe('createSmartAuthMiddleware', () => {
  let env: TestEnv;

  beforeEach(async () => {
    env = await setupTestEnv();
  });

  afterEach(async () => {
    await new Promise((resolve) => env.server.close(resolve));
  });

  it('a real access token verifies and the route handler runs (200)', async () => {
    const token = await env.mintToken('system/*.read');
    // Sanity: the token is signed with the same HS256 secret the middleware
    // verifies against (verifies via the same `verifyAccessToken` helper the
    // token server exposes — single source of truth for the sign/verify key).
    expect(verifyAccessToken(token)).toMatchObject({ scope: 'system/*.read' });

    const res = await request(env.buildApp()).get('/test').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('a missing Authorization header is rejected with 401 missing_token', async () => {
    const res = await request(env.buildApp()).get('/test');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'smart_auth_failed', reason: 'missing_token' });
  });

  it('a tampered token (flipped byte) is rejected with 401 invalid_signature', async () => {
    // Build a real token, then flip a byte in the signature segment (last of
    // the three dot-separated base64url parts). Signature now no longer
    // matches what was signed by the token server — middleware must report
    // `invalid_signature` (not `malformed_token`, since the structure is fine).
    const token = await env.mintToken('system/*.read');
    const parts = token.split('.');
    // Flip a single character in the signature; signatures use base64url
    // alphabet — 'A' is always a valid alternative to any letter in it.
    parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
    const tampered = parts.join('.');

    const res = await request(env.buildApp()).get('/test').set('Authorization', `Bearer ${tampered}`);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'smart_auth_failed', reason: 'invalid_signature' });
  });

  it('an expired token is rejected with 401 token_expired', async () => {
    // Mint directly with `exp` already in the past (token server only mints
    // fresh tokens with its 5-minute TTL). Signed with the same secret the
    // middleware verifies against so signature passes and only the expiry
    // gate fails — that's the exact reason code we want to assert.
    const expired = env.signDirect({
      sub: 'caresync-api',
      client_id: 'caresync-api',
      scope: 'system/*.read',
      exp: Math.floor(Date.now() / 1000) - 60,
      iat: Math.floor(Date.now() / 1000) - 120,
    });

    const res = await request(env.buildApp()).get('/test').set('Authorization', `Bearer ${expired}`);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'smart_auth_failed', reason: 'token_expired' });
  });

  it('a token without the required scope for the route method is rejected with 403 insufficient_scope', async () => {
    // Token carries only read scope; the configured rule for POST requires
    // `patient/*.write`. Signature and exp pass — only the scope gate fails,
    // so the response is 403 (not 401) per the spec'd reason codes.
    const token = await env.mintToken('patient/*.read');
    const app = env.buildApp({
      serverSecret: DEFAULT_SERVER_SECRET,
      requiredScopesByMethod: { POST: ['patient/*.write'] },
    });

    const res = await request(app).post('/test').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'smart_auth_failed', reason: 'insufficient_scope' });
  });

  it('passes through when req.auth is already set by an upstream middleware (no double-auth)', async () => {
    // Post-Commit-4 regression guard: the inner `requireAuth` middleware on
    // HAPI-touching routes (e.g. routes/patients.ts) validates login JWTs and
    // sets `req.auth`. If smartAuth were to reject login JWTs on top of that,
    // every legitimate API caller would 401. The fix: smartAuth short-circuits
    // when `req.auth` is already set, passing through to the route handler
    // untouched. This test simulates that ordering — fake "login tier" runs
    // first, sets req.auth; smartAuth should NOT validate the SMART shape.
    const a = express();
    a.use((req, _res, next) => {
      // Pretend a login JWT was validated upstream. The token in the
      // Authorization header is NOT a SMART token — if smartAuth ran its
      // full validation it would reject with `invalid_signature`.
      (req as { auth?: unknown }).auth = { id: 'test', name: 'Test', role: 'director' };
      next();
    });
    a.get('/test', createSmartAuthMiddleware({ serverSecret: DEFAULT_SERVER_SECRET }), (_req, res) =>
      res.json({ ok: true })
    );
    a.use(smartAuthErrorHandler);

    const res = await request(a).get('/test').set('Authorization', 'Bearer this-is-not-a-smart-token');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('route-level scopes take precedence over method-level scopes', async () => {
    // S17 (Open Question 8): route-level scope requirements override the
    // coarse method-level gate. A token with `patient/Patient.read` passes
    // the method-level GET gate (which accepts `patient/*.read`), but the
    // route-level rule for `GET /api/patients/:id` requires
    // `patient/Patient.read` specifically — which also passes. The test
    // verifies the route-level path is matched and enforced.
    const token = await env.mintToken('patient/Patient.read');
    const app = env.buildApp({
      serverSecret: DEFAULT_SERVER_SECRET,
      requiredScopesByMethod: { GET: ['system/*.read'] },
      requiredScopesByRoute: { 'GET /test': ['patient/Patient.read'] },
    });

    const res = await request(app).get('/test').set('Authorization', `Bearer ${token}`);

    // Method-level would reject (patient/Patient.read doesn't match system/*.read
    // as an exact string, but wildcard matching makes system/*.read NOT match
    // patient/Patient.read — the * is in the context slot, not the resource).
    // Route-level accepts patient/Patient.read → 200.
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('route-level scopes reject a token that would pass method-level', async () => {
    // Token has `system/*.read` (passes method-level GET gate), but the
    // route-level rule requires `patient/Patient.read` specifically.
    // `system/*.read` does NOT match `patient/Patient.read` — the context
    // segment differs (system vs patient), and wildcards only match within
    // the same segment position.
    const token = await env.mintToken('system/*.read');
    const app = env.buildApp({
      serverSecret: DEFAULT_SERVER_SECRET,
      requiredScopesByMethod: { GET: ['system/*.read', 'patient/*.read'] },
      requiredScopesByRoute: { 'GET /test': ['patient/Patient.read'] },
    });

    const res = await request(app).get('/test').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'smart_auth_failed', reason: 'insufficient_scope' });
  });

  it('wildcard scope matching: system/*.read grants system/Patient.read', async () => {
    // S17: SMART wildcard scopes — `system/*.read` should match any
    // `system/<Resource>.read` requirement. The middleware splits on `/`
    // and `.`, then checks each segment for `*` wildcard.
    const token = await env.mintToken('system/*.read');
    const app = env.buildApp({
      serverSecret: DEFAULT_SERVER_SECRET,
      requiredScopesByRoute: { 'GET /test': ['system/Patient.read'] },
    });

    const res = await request(app).get('/test').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('wildcard scope matching: patient/*.read does NOT grant system/Patient.read', async () => {
    // The wildcard only matches within its segment position — `patient/*`
    // cannot satisfy a `system/*` requirement (different context).
    const token = await env.mintToken('patient/*.read');
    const app = env.buildApp({
      serverSecret: DEFAULT_SERVER_SECRET,
      requiredScopesByRoute: { 'GET /test': ['system/Patient.read'] },
    });

    const res = await request(app).get('/test').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'smart_auth_failed', reason: 'insufficient_scope' });
  });

  it('throws at construction time if neither serverSecret nor jwksUrl is provided', () => {
    expect(() => createSmartAuthMiddleware({} as never)).toThrow('serverSecret');
  });

  it('multi-client token server rejects unauthorized scope', async () => {
    // S17 (Open Question 8): multi-client mode — a client registered with
    // only `patient/*.read` should be rejected if it requests `system/*.write`.
    const keys = generateKeyPair();
    const app = express();
    app.use(express.urlencoded({ extended: true }));
    app.use(express.json());
    const server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const port = (server.address() as AddressInfo).port;
    const tokenEndpoint = `http://localhost:${port}/smart/token`;

    app.use('/smart', createTokenServer({
      tokenEndpoint,
      clients: [{
        clientId: 'caresync-social-worker',
        publicKey: keys.publicKey,
        allowedScopes: ['patient/Patient.read', 'patient/Observation.read', 'patient/Task.read', 'patient/Task.write'],
      }],
    }));

    const client = new SmartTokenClient({
      clientId: 'caresync-social-worker',
      tokenEndpoint,
      privateKey: keys.privateKey,
      scope: 'system/*.write',
    });

    await expect(client.getAccessToken()).rejects.toThrow();

    await new Promise((resolve) => server.close(resolve));
  });

  it('multi-client token server accepts authorized scope', async () => {
    // The same client requesting a scope it IS registered for should succeed.
    const keys = generateKeyPair();
    const app = express();
    app.use(express.urlencoded({ extended: true }));
    app.use(express.json());
    const server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const port = (server.address() as AddressInfo).port;
    const tokenEndpoint = `http://localhost:${port}/smart/token`;

    app.use('/smart', createTokenServer({
      tokenEndpoint,
      clients: [{
        clientId: 'caresync-social-worker',
        publicKey: keys.publicKey,
        allowedScopes: ['patient/Patient.read', 'patient/Observation.read', 'patient/Task.read', 'patient/Task.write'],
      }],
    }));

    const client = new SmartTokenClient({
      clientId: 'caresync-social-worker',
      tokenEndpoint,
      privateKey: keys.privateKey,
      scope: 'patient/Patient.read',
    });

    const token = await client.getAccessToken();
    expect(verifyAccessToken(token)).toMatchObject({ scope: 'patient/Patient.read' });

    await new Promise((resolve) => server.close(resolve));
  });
});
