import jwt from 'jsonwebtoken';
import crypto from 'crypto';

export interface MintAssertionOptions {
  clientId: string;
  tokenEndpoint: string;
  privateKey: string;
}

/** SMART Backend Services client assertion (RFC 7523 private_key_jwt). */
export function mintClientAssertion({ clientId, tokenEndpoint, privateKey }: MintAssertionOptions): string {
  return jwt.sign(
    {
      iss: clientId,
      sub: clientId,
      aud: tokenEndpoint,
      jti: crypto.randomUUID(),
    },
    privateKey,
    { algorithm: 'RS256', expiresIn: '5m' }
  );
}
