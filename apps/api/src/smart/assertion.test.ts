import jwt from 'jsonwebtoken';
import { generateKeyPair } from './keys';
import { mintClientAssertion } from './assertion';

describe('mintClientAssertion', () => {
  it('produces a JWT verifiable with the matching public key', () => {
    const { publicKey, privateKey } = generateKeyPair();
    const token = mintClientAssertion({
      clientId: 'caresync-api',
      tokenEndpoint: 'http://localhost:4000/smart/token',
      privateKey,
    });

    const payload = jwt.verify(token, publicKey, { algorithms: ['RS256'] }) as jwt.JwtPayload;
    expect(payload.iss).toBe('caresync-api');
    expect(payload.sub).toBe('caresync-api');
    expect(payload.aud).toBe('http://localhost:4000/smart/token');
    expect(payload.jti).toEqual(expect.any(String));
  });

  it('rejects verification against a different key', () => {
    const { privateKey } = generateKeyPair();
    const other = generateKeyPair();
    const token = mintClientAssertion({
      clientId: 'caresync-api',
      tokenEndpoint: 'http://localhost:4000/smart/token',
      privateKey,
    });

    expect(() => jwt.verify(token, other.publicKey, { algorithms: ['RS256'] })).toThrow();
  });
});
