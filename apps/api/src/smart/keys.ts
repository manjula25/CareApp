import crypto from 'crypto';

export interface KeyPair {
  publicKey: string;
  privateKey: string;
}

/**
 * SMART Backend Services registers a client's public key with the
 * authorization server out of band. For this POC both sides live in one
 * process, so a keypair is generated once at boot and shared in memory —
 * there is no separate client/server registration step to model.
 */
export function generateKeyPair(): KeyPair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey, privateKey };
}
