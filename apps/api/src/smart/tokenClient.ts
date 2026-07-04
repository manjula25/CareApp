import { mintClientAssertion } from './assertion';

export interface SmartTokenClientOptions {
  clientId: string;
  tokenEndpoint: string;
  privateKey: string;
  scope?: string;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

const EXPIRY_SAFETY_MARGIN_MS = 30_000;

export class SmartTokenClient {
  private cached: CachedToken | null = null;

  constructor(private readonly options: SmartTokenClientOptions) {}

  async getAccessToken(): Promise<string> {
    if (this.cached && this.cached.expiresAt > Date.now()) {
      return this.cached.accessToken;
    }

    const assertion = mintClientAssertion({
      clientId: this.options.clientId,
      tokenEndpoint: this.options.tokenEndpoint,
      privateKey: this.options.privateKey,
    });

    const res = await fetch(this.options.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
        client_assertion: assertion,
        ...(this.options.scope ? { scope: this.options.scope } : {}),
      }),
    });

    if (!res.ok) {
      throw new Error(`SMART token exchange failed: ${res.status} ${await res.text()}`);
    }

    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.cached = {
      accessToken: body.access_token,
      expiresAt: Date.now() + body.expires_in * 1000 - EXPIRY_SAFETY_MARGIN_MS,
    };
    return this.cached.accessToken;
  }
}
