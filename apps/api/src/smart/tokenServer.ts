import { Router } from 'express';
import jwt from 'jsonwebtoken';

export interface ClientRegistration {
  clientId: string;
  publicKey: string;
  allowedScopes: string[];
}

export interface TokenServerOptions {
  /** Single-client POC mode (backward compat). When set, this client is
   * registered with an empty `allowedScopes` array, meaning any scope is
   * accepted (self-attested, as in the original POC). */
  clientId?: string;
  clientPublicKey?: string;
  /** Multi-client production mode. When set, each client's requested scopes
   * are validated against its `allowedScopes` — a scope not in the allowed
   * set is rejected with `invalid_scope`. */
  clients?: ClientRegistration[];
  tokenEndpoint: string;
  /** Signs issued access tokens. Separate from the client's keypair. */
  serverSecret?: string;
  /** Audience claim set on issued access tokens (production: HAPI FHIR base URL). */
  audience?: string;
}

const DEFAULT_SERVER_SECRET = 'caresync-dev-authz-server-secret-do-not-use-in-production';
const ACCESS_TOKEN_TTL_SECONDS = 300;

interface ClientRecord {
  clientId: string;
  publicKey: string;
  allowedScopes: Set<string> | null;
}

/**
 * Minimal SMART Backend Services authorization server: verifies the
 * client's signed JWT assertion (RFC 7523) against its registered public
 * key, then issues a signed access token. Self-hosted for this POC — there
 * is no separate authorization server to stand up.
 *
 * Multi-client mode (S17 / Open Question 8): when `clients` is provided,
 * each client has its own public key and an `allowedScopes` list. Requested
 * scopes are validated against the client's allowed set — a scope not in
 * the allowed list is rejected with `invalid_scope`. This is the
 * production-shaped replacement for the POC's self-attested scope model.
 */
export function createTokenServer(options: TokenServerOptions): Router {
  const serverSecret = options.serverSecret ?? DEFAULT_SERVER_SECRET;
  const router = Router();

  // Build client registry. Single-client POC mode is converted to a
  // one-entry map with null allowedScopes (accept any scope).
  const clientMap = new Map<string, ClientRecord>();
  if (options.clients) {
    for (const c of options.clients) {
      clientMap.set(c.clientId, {
        clientId: c.clientId,
        publicKey: c.publicKey,
        allowedScopes: new Set(c.allowedScopes),
      });
    }
  } else if (options.clientId && options.clientPublicKey) {
    clientMap.set(options.clientId, {
      clientId: options.clientId,
      publicKey: options.clientPublicKey,
      allowedScopes: null,
    });
  }

  router.post('/token', (req, res) => {
    const { client_assertion: assertion, scope } = req.body as { client_assertion?: string; scope?: string };
    if (!assertion) {
      res.status(400).json({ error: 'invalid_request', error_description: 'client_assertion is required' });
      return;
    }

    // Decode the assertion without verifying to extract the issuer (client_id).
    const decoded = jwt.decode(assertion);
    if (!decoded || typeof decoded !== 'object') {
      res.status(401).json({ error: 'invalid_client', error_description: 'client assertion is malformed' });
      return;
    }
    const clientId = (decoded as jwt.JwtPayload).iss;
    const client = clientId ? clientMap.get(clientId) : undefined;
    if (!client) {
      res.status(401).json({ error: 'invalid_client', error_description: 'unknown client' });
      return;
    }

    let claims: jwt.JwtPayload;
    try {
      claims = jwt.verify(assertion, client.publicKey, {
        algorithms: ['RS256'],
        audience: options.tokenEndpoint,
        issuer: client.clientId,
        subject: client.clientId,
      }) as jwt.JwtPayload;
    } catch {
      res.status(401).json({ error: 'invalid_client', error_description: 'client assertion failed verification' });
      return;
    }

    const requestedScopes = scope ?? 'system/*.read';

    // Multi-client scope validation: reject scopes the client isn't registered for.
    if (client.allowedScopes !== null) {
      const requestedSet = requestedScopes.split(/\s+/).filter(Boolean);
      const unauthorized = requestedSet.filter((s) => !client.allowedScopes!.has(s));
      if (unauthorized.length > 0) {
        res.status(400).json({
          error: 'invalid_scope',
          error_description: `Client '${client.clientId}' is not authorized for scope(s): ${unauthorized.join(' ')}`,
        });
        return;
      }
    }

    const tokenPayload: Record<string, unknown> = {
      client_id: claims.iss,
      scope: requestedScopes,
    };
    if (options.audience) {
      tokenPayload.aud = options.audience;
    }

    const accessToken = jwt.sign(tokenPayload, serverSecret, {
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    });

    res.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      scope: requestedScopes,
    });
  });

  return router;
}

export function verifyAccessToken(token: string, serverSecret = DEFAULT_SERVER_SECRET): jwt.JwtPayload {
  return jwt.verify(token, serverSecret) as jwt.JwtPayload;
}
