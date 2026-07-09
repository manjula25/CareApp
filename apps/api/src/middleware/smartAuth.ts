import { NextFunction, Request, Response, Router } from 'express';
import jwt from 'jsonwebtoken';
import { verifyAccessToken } from '../smart/tokenServer';

type GetSigningKeyCallback = (err: Error | null, key?: { getPublicKey: () => string }) => void;
interface JwksClientLike {
  getSigningKey(kid: string, cb: GetSigningKeyCallback): void;
}

/**
 * S14 Commit 4 + S17 (Open Question 8) — SMART-on-FHIR enforcement at the
 * app tier (developer guard that gives a structured 401/403 in front of
 * HAPI's binary accept/reject).
 *
 * Two verification modes:
 *
 * - **HS256 (POC):** `serverSecret` is set → verifies against the in-process
 *   token server's shared secret. This is the existing S14 behavior.
 *
 * - **RS256 (production):** `jwksUrl` is set → fetches signing keys from the
 *   Keycloak JWKS endpoint at runtime, verifies RS256 tokens issued by the
 *   real SMART authorization server. Supports key rotation without restart.
 *
 * If both are set, RS256 takes precedence. If neither is set, the middleware
 * throws at construction time (misconfiguration).
 *
 * Scope enforcement also has two levels:
 *
 * - **Method-level (POC):** `requiredScopesByMethod` — coarse GET/POST gate.
 * - **Route-level (production):** `requiredScopesByRoute` — per-endpoint
 *   scopes like `GET /api/patients/:id → ['patient/Patient.read']`.
 *
 * Route-level takes precedence when both are configured.
 */
export type SmartAuthReason =
  | 'missing_token'
  | 'malformed_token'
  | 'invalid_signature'
  | 'token_expired'
  | 'wrong_audience'
  | 'insufficient_scope';

export class SmartAuthError extends Error {
  constructor(public statusCode: number, public reason: SmartAuthReason) {
    super(`SMART auth failed: ${reason}`);
    this.name = 'SmartAuthError';
  }
}

export interface SmartAuthClaims {
  sub?: string;
  scope?: string;
  exp?: number;
  client_id?: string;
  iss?: string;
  fhirUser?: string;
}

export interface SmartAuthMiddlewareOptions {
  /**
   * HS256 secret for POC mode (in-process token server). Optional when
   * `jwksUrl` is set (RS256 production mode). Exactly one of `serverSecret`
   * or `jwksUrl` must be provided.
   */
  serverSecret?: string;
  /**
   * JWKS endpoint URL for RS256 production mode (e.g. Keycloak's
   * `https://keycloak:8443/realms/caresync/protocol/openid-connect/certs`).
   * When set, the middleware fetches signing keys at runtime via `jwks-rsa`,
   * supporting key rotation without container restart.
   */
  jwksUrl?: string;
  /**
   * Expected token issuer (`iss` claim) for RS256 mode. When set, tokens
   * with a mismatched `iss` are rejected with `invalid_signature`.
   */
  issuer?: string;
  /**
   * If set, the `aud` claim on the access token must match. In POC mode the
   * token server does not set `aud` on access tokens, so this is opt-in.
   * In production mode (Keycloak), `aud` should be the HAPI FHIR base URL.
   */
  audience?: string;
  /**
   * Required scopes keyed by HTTP method (POC mode). A method absent from
   * the map is not scope-gated. Token scope is space-delimited (RFC 6749
   * §3.3); every required scope must appear in the granted set. Wildcards
   * like `patient/*.read` are NOT expanded — callers must enumerate exact
   * scopes.
   */
  requiredScopesByMethod?: Record<string, string[]>;
  /**
   * Required scopes keyed by route pattern (production mode). Patterns use
   * Express-style params: `'GET /api/patients/:id' → ['patient/Patient.read']`.
   * Route-level takes precedence over method-level when both are configured.
   * The path is matched against `req.baseUrl + req.path` so it works
   * regardless of where the middleware is mounted.
   */
  requiredScopesByRoute?: Record<string, string[]>;
  /**
   * Clock tolerance (seconds) for the `exp` check (default 30).
   */
  clockToleranceSeconds?: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      smartAuth?: SmartAuthClaims;
    }
  }
}

function scopeMatches(granted: string, required: string): boolean {
  if (granted === required) return true;
  const gParts = granted.split(/[/.]/);
  const rParts = required.split(/[/.]/);
  if (gParts.length !== 3 || rParts.length !== 3) return false;
  return gParts.every((g, i) => g === '*' || rParts[i] === '*' || g === rParts[i]);
}

function scopeGrantsRequired(granted: string | undefined, required: string[]): boolean {
  if (required.length === 0) return true;
  if (!granted) return false;
  const grantedSet = granted.split(/\s+/).filter(Boolean);
  return required.every((req) => grantedSet.some((g) => scopeMatches(g, req)));
}

/**
 * Compiles an Express-style route pattern (e.g. `'GET /api/patients/:id'`)
 * into a `{ method, regex }` pair for matching incoming requests. `:param`
 * segments become `[^/]+`, `*` becomes `.*`, and the path is anchored.
 */
interface CompiledRoutePattern {
  method: string;
  regex: RegExp;
  scopes: string[];
}

function compileRoutePattern(pattern: string, scopes: string[]): CompiledRoutePattern {
  const spaceIdx = pattern.indexOf(' ');
  const method = spaceIdx > 0 ? pattern.slice(0, spaceIdx).toUpperCase() : 'GET';
  const path = spaceIdx > 0 ? pattern.slice(spaceIdx + 1) : pattern;
  const regexStr = path
    .replace(/:[^/]+/g, '[^/]+')
    .replace(/\*/g, '.*');
  return { method, regex: new RegExp(`^${regexStr}$`), scopes };
}

function matchRouteScopes(
  compiled: CompiledRoutePattern[],
  method: string,
  path: string
): string[] | null {
  for (const entry of compiled) {
    if (entry.method === method && entry.regex.test(path)) {
      return entry.scopes;
    }
  }
  return null;
}

/**
 * Express middleware factory. Reads the `Authorization: Bearer <jwt>` header,
 * verifies the JWT against `serverSecret` (HS256), and gates `exp`/`aud`/
 * scope. On success attaches `req.smartAuth = { sub, scope, exp, client_id }`
 * and calls `next()` with no argument. On any failure calls `next(new
 * SmartAuthError(...))` with a stable `reason` code; the matching
 * `smartAuthErrorHandler` translates that to a JSON `{ error, reason }`
 * response. The `reason` enum is the only thing a client should branch on
 * — the human-readable `error` string is for logs.
 */
export function createSmartAuthMiddleware(options: SmartAuthMiddlewareOptions) {
  const {
    serverSecret,
    jwksUrl,
    issuer,
    audience,
    requiredScopesByMethod,
    requiredScopesByRoute,
    clockToleranceSeconds = 30,
  } = options;

  if (!serverSecret && !jwksUrl) {
    throw new Error('SmartAuth: either serverSecret (HS256) or jwksUrl (RS256) must be set');
  }

  // RS256 mode: create a JWKS client that caches and rate-limits key fetches.
  // Lazy require so the ESM-only `jose` transitive dep is never loaded in
  // HS256 POC mode (and doesn't break Jest's CommonJS transform). `jwks-rsa`
  // is CommonJS, so a synchronous require keeps this factory non-async.
  let jwksClient: JwksClientLike | null = null;
  if (jwksUrl) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { JwksClient } = require('jwks-rsa') as typeof import('jwks-rsa');
    jwksClient = new JwksClient({
      jwksUri: jwksUrl,
      cache: true,
      cacheMaxEntries: 5,
      rateLimit: true,
      jwksRequestsPerMinute: 10,
    });
  }

  // Pre-compile route patterns for production mode.
  const compiledRoutes: CompiledRoutePattern[] = [];
  if (requiredScopesByRoute) {
    for (const [pattern, scopes] of Object.entries(requiredScopesByRoute)) {
      compiledRoutes.push(compileRoutePattern(pattern, scopes));
    }
  }

  return function smartAuth(req: Request, _res: Response, next: NextFunction): void {
    // S14 follow-up — no double-auth: if the inner `requireAuth` (login-tier
    // JWT validator) has already authenticated this request, pass through.
    // The POC's two auth schemes (login JWT via `auth/jwt.ts` + SMART access
    // token via `smart/tokenServer.ts`) are mutually exclusive in shape, so a
    // request that passed `requireAuth` carries a login JWT — validating it
    // against the SMART serverSecret would 401 every legitimate API caller
    // (caught by live smoke test after Commit 4). SMART-shape tokens that
    // fail `requireAuth` are still rejected upstream; that's a separate
    // concern (requireAuth needs to learn SMART tokens too) tracked in
    // verification-s14.md §6 #7.
    if (req.auth) {
      next();
      return;
    }

    const header = req.header('Authorization');
    if (!header || !header.startsWith('Bearer ')) {
      next(new SmartAuthError(401, 'missing_token'));
      return;
    }
    const token = header.slice('Bearer '.length).trim();
    if (!token) {
      next(new SmartAuthError(401, 'missing_token'));
      return;
    }

    // Structure check FIRST so a nonsense-but-Bearer-prefixed header is
    // reported as `malformed_token` (a client error about shape) rather than
    // `invalid_signature` (a server-side signature mismatch). The HS256
    // verify below will catch any other tampering.
    const decodedUnverified = jwt.decode(token);
    if (!decodedUnverified || typeof decodedUnverified !== 'object') {
      next(new SmartAuthError(401, 'malformed_token'));
      return;
    }

    let claims: jwt.JwtPayload;
    try {
      if (jwksClient) {
        // RS256 production mode: verify against Keycloak's JWKS endpoint.
        claims = jwt.verify(token, (header: jwt.JwtHeader, callback: jwt.SigningKeyCallback) => {
          if (header.kid === undefined) {
            callback(new Error('Token missing kid header'));
            return;
          }
          jwksClient.getSigningKey(header.kid, (err: Error | null, key) => {
            if (err || !key) {
              callback(err ?? new Error('Signing key not found'));
              return;
            }
            callback(null, key.getPublicKey());
          });
        }, {
          algorithms: ['RS256'],
          ...(issuer ? { issuer } : {}),
          ...(audience ? { audience } : {}),
        }) as unknown as jwt.JwtPayload;
      } else {
        // HS256 POC mode: verify against the in-process token server's secret.
        claims = verifyAccessToken(token, serverSecret!) as jwt.JwtPayload;
      }
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        next(new SmartAuthError(401, 'token_expired'));
        return;
      }
      // Covers JsonWebTokenError + everything else (bad signature, bad
      // algorithm, malformed payload, audience mismatch if it were set on
      // verify, ...). For this POC every non-expiry verify failure surfaces
      // as `invalid_signature` — keeps the reason space small and matches
      // what most clients need to do (re-mint + retry).
      next(new SmartAuthError(401, 'invalid_signature'));
      return;
    }

    // Audience check: in RS256 mode, jwt.verify already enforces audience
    // when the option is passed. In HS256 mode, verifyAccessToken doesn't,
    // so do it here. Running it in both modes is harmless (belt-and-suspenders).
    if (audience !== undefined) {
      const aud = claims.aud;
      const audMatches = Array.isArray(aud) ? aud.includes(audience) : aud === audience;
      if (!audMatches) {
        next(new SmartAuthError(401, 'wrong_audience'));
        return;
      }
    }

    // `exp` second-line check: the verify-side enforces it with the
    // configured clock tolerance. If a token's exp is in the past at
    // verify time, TokenExpiredError already fired above; this guard
    // exists as a belt-and-suspenders defense in case clockTolerance is
    // set generously and a request arrives between the boundary and the
    // tolerance window.
    if (typeof claims.exp === 'number' && Date.now() / 1000 - clockToleranceSeconds >= claims.exp) {
      next(new SmartAuthError(401, 'token_expired'));
      return;
    }

    // Route-level scope check (production) takes precedence over method-level (POC).
    const fullPath = req.baseUrl + req.path;
    let required: string[];
    const routeScopes = matchRouteScopes(compiledRoutes, req.method, fullPath);
    if (routeScopes !== null) {
      required = routeScopes;
    } else {
      required = requiredScopesByMethod?.[req.method] ?? [];
    }
    if (!scopeGrantsRequired(claims.scope as string | undefined, required)) {
      next(new SmartAuthError(403, 'insufficient_scope'));
      return;
    }

    req.smartAuth = {
      sub: claims.sub as string | undefined,
      scope: claims.scope as string | undefined,
      exp: claims.exp as number | undefined,
      client_id: claims.client_id as string | undefined,
      iss: claims.iss as string | undefined,
      fhirUser: (claims as Record<string, unknown>).fhirUser as string | undefined,
    };
    next();
  };
}

/**
 * Attaches the smartAuth middleware to a router's middleware stack at
 * runtime, AFTER any middleware the router's factory already added (e.g.
 * `requireAuth` in `routes/patients.ts`). Returns the same router for
 * chaining. The caller pattern is:
 *
 *   app.use('/api/patients', wrapRouterWithSmartAuth(createPatientsRouter(fhirService), smartAuth));
 *
 * This is the post-Commit-4 fix for the regression where the smartAuth
 * middleware was mounted AHEAD of the route's inner `requireAuth` via
 * `app.use('/api/...', smartAuth, router)`, which caused login-JWT calls
 * to be rejected with `invalid_signature` before `requireAuth` ran. The
 * no-double-auth pass-through inside `smartAuth` (the `req.auth` check
 * at the top) is what makes the reordering safe — login JWTs flow
 * through smartAuth untouched, SMART tokens still hit the full
 * validation path.
 */
export function wrapRouterWithSmartAuth(router: Router, smartAuth: ReturnType<typeof createSmartAuthMiddleware>): Router {
  router.use(smartAuth);
  return router;
}

/**
 * Express error handler for the smartAuth middleware. Translates
 * `SmartAuthError` instances into the documented JSON response shape
 * (`{ error: 'smart_auth_failed', reason }`); passes every other error
 * through to the next error handler so it can be logged / handled by the
 * project's general 500 fallback (see index.ts). MUST be mounted after
 * the smartAuth middleware (Express runs error handlers in mount order,
 * so putting this before any route that uses smartAuth is correct).
 */
export function smartAuthErrorHandler(
  err: Error,
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  if (err instanceof SmartAuthError) {
    res.status(err.statusCode).json({ error: 'smart_auth_failed', reason: err.reason });
    return;
  }
  next(err);
}
