import express from 'express';
import { AddressInfo } from 'net';
import { Server } from 'http';
import { generateKeyPair, KeyPair } from './keys';
import { createTokenServer, verifyAccessToken } from './tokenServer';
import { SmartTokenClient } from './tokenClient';

describe('SmartTokenClient', () => {
  let server: Server;
  let tokenEndpoint: string;
  let keys: KeyPair;
  let requestCount: number;

  beforeEach(async () => {
    requestCount = 0;
    keys = generateKeyPair();
    const app = express();
    app.use(express.urlencoded({ extended: true }));
    app.use((_req, _res, next) => {
      requestCount++;
      next();
    });
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const port = (server.address() as AddressInfo).port;
    tokenEndpoint = `http://localhost:${port}/smart/token`;
    app.use(
      '/smart',
      createTokenServer({ clientId: 'caresync-api', tokenEndpoint, clientPublicKey: keys.publicKey })
    );
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('mints an assertion and exchanges it for an access token', async () => {
    const client = new SmartTokenClient({ clientId: 'caresync-api', tokenEndpoint, privateKey: keys.privateKey });

    const token = await client.getAccessToken();
    const payload = verifyAccessToken(token);
    expect(payload.client_id).toBe('caresync-api');
    expect(requestCount).toBe(1);
  });

  it('caches the token until near expiry instead of re-exchanging every call', async () => {
    const client = new SmartTokenClient({ clientId: 'caresync-api', tokenEndpoint, privateKey: keys.privateKey });

    await client.getAccessToken();
    await client.getAccessToken();
    await client.getAccessToken();

    expect(requestCount).toBe(1);
  });
});
