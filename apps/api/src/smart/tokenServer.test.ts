import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { generateKeyPair } from './keys';
import { mintClientAssertion } from './assertion';
import { createTokenServer } from './tokenServer';

const TOKEN_ENDPOINT = 'http://localhost:4000/smart/token';
const CLIENT_ID = 'caresync-api';

function buildApp(clientPublicKey: string) {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use('/smart', createTokenServer({ clientId: CLIENT_ID, tokenEndpoint: TOKEN_ENDPOINT, clientPublicKey }));
  return app;
}

describe('POST /smart/token', () => {
  it('issues a signed access token for a valid client assertion', async () => {
    const { publicKey, privateKey } = generateKeyPair();
    const app = buildApp(publicKey);
    const assertion = mintClientAssertion({ clientId: CLIENT_ID, tokenEndpoint: TOKEN_ENDPOINT, privateKey });

    const res = await request(app).post('/smart/token').type('form').send({
      grant_type: 'client_credentials',
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: assertion,
      scope: 'system/*.read',
    });

    expect(res.status).toBe(200);
    expect(res.body.token_type).toBe('Bearer');
    expect(res.body.expires_in).toBeGreaterThan(0);
    const decoded = jwt.decode(res.body.access_token) as jwt.JwtPayload;
    expect(decoded.scope).toBe('system/*.read');
    expect(decoded.client_id).toBe(CLIENT_ID);
  });

  it('rejects an assertion signed by an unregistered key', async () => {
    const { publicKey } = generateKeyPair();
    const impostor = generateKeyPair();
    const app = buildApp(publicKey);
    const assertion = mintClientAssertion({
      clientId: CLIENT_ID,
      tokenEndpoint: TOKEN_ENDPOINT,
      privateKey: impostor.privateKey,
    });

    const res = await request(app).post('/smart/token').type('form').send({
      grant_type: 'client_credentials',
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: assertion,
    });

    expect(res.status).toBe(401);
  });

  it('rejects a request missing the client assertion', async () => {
    const { publicKey } = generateKeyPair();
    const app = buildApp(publicKey);
    const res = await request(app).post('/smart/token').type('form').send({ grant_type: 'client_credentials' });
    expect(res.status).toBe(400);
  });
});
