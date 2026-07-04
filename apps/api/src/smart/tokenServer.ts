import { Router } from 'express';
import jwt from 'jsonwebtoken';

export interface TokenServerOptions {
  clientId: string;
  tokenEndpoint: string;
  clientPublicKey: string;
  /** Signs issued access tokens. Separate from the client's keypair. */
  serverSecret?: string;
}

const DEFAULT_SERVER_SECRET = 'caresync-dev-authz-server-secret-do-not-use-in-production';
const ACCESS_TOKEN_TTL_SECONDS = 300;

/**
 * Minimal SMART Backend Services authorization server: verifies the
 * client's signed JWT assertion (RFC 7523) against its registered public
 * key, then issues a signed access token. Self-hosted for this POC — there
 * is no separate authorization server to stand up.
 */
export function createTokenServer(options: TokenServerOptions): Router {
  const serverSecret = options.serverSecret ?? DEFAULT_SERVER_SECRET;
  const router = Router();

  router.post('/token', (req, res) => {
    const { client_assertion: assertion, scope } = req.body as { client_assertion?: string; scope?: string };
    if (!assertion) {
      res.status(400).json({ error: 'invalid_request', error_description: 'client_assertion is required' });
      return;
    }

    let claims: jwt.JwtPayload;
    try {
      claims = jwt.verify(assertion, options.clientPublicKey, {
        algorithms: ['RS256'],
        audience: options.tokenEndpoint,
        issuer: options.clientId,
        subject: options.clientId,
      }) as jwt.JwtPayload;
    } catch {
      res.status(401).json({ error: 'invalid_client', error_description: 'client assertion failed verification' });
      return;
    }

    const accessToken = jwt.sign({ client_id: claims.iss, scope: scope ?? 'system/*.read' }, serverSecret, {
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    });

    res.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      scope: scope ?? 'system/*.read',
    });
  });

  return router;
}

export function verifyAccessToken(token: string, serverSecret = DEFAULT_SERVER_SECRET): jwt.JwtPayload {
  return jwt.verify(token, serverSecret) as jwt.JwtPayload;
}
