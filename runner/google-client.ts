/**
 * Shared Google OAuth2 client for the local runner.
 *
 * A single OAuth grant covers both Calendar event writes and Gmail send, so
 * calendar.ts and email.ts both build their API clients from the one client
 * created here. Tokens (including the long-lived refresh token) are stored in
 * runner/.google-token.json after a one-time `npm run google:auth`.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import { google } from 'googleapis';

/**
 * The OAuth2 client type as googleapis itself constructs it. We build via
 * `google.auth.OAuth2` (rather than importing OAuth2Client from
 * google-auth-library directly) so the instance is assignment-compatible with
 * `google.calendar()` / `google.gmail()` — googleapis-common bundles its own
 * copy of google-auth-library, and the two OAuth2Client declarations don't
 * unify structurally.
 */
export type GoogleAuthClient = InstanceType<typeof google.auth.OAuth2>;

/** Loopback redirect used by the one-time auth flow (runner/google-auth.ts). */
export const REDIRECT_URI = 'http://localhost:5858/oauth2callback';

/** The single grant: create/update calendar events + send mail as the user. */
export const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/gmail.send',
];

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Where the refresh token lives after `npm run google:auth`. */
export const TOKEN_PATH = path.join(HERE, '.google-token.json');

/** True when the OAuth client id + secret are configured in the environment. */
export function hasGoogleCreds(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/** True when a saved token file exists (i.e. the auth flow has been run). */
export function hasGoogleToken(): boolean {
  return existsSync(TOKEN_PATH);
}

/** Build a bare OAuth2 client from env creds (no tokens loaded). */
export function buildOAuthClient(): GoogleAuthClient {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    REDIRECT_URI,
  );
}

/**
 * Build an OAuth2 client with saved tokens loaded and auto-refresh wired up.
 * The refresh token lets google-auth-library mint fresh access tokens on
 * demand; rotated tokens are persisted back to disk.
 *
 * Throws a clear error if credentials or the saved token are missing.
 */
export async function getOAuthClient(): Promise<GoogleAuthClient> {
  if (!hasGoogleCreds()) {
    throw new Error(
      'Google credentials missing. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.',
    );
  }
  if (!hasGoogleToken()) {
    throw new Error(
      `No Google token found at ${TOKEN_PATH}. Run \`npm run google:auth\` once to authorize.`,
    );
  }

  const client = buildOAuthClient();
  const tokens = JSON.parse(readFileSync(TOKEN_PATH, 'utf8'));
  client.setCredentials(tokens);

  // A refresh only returns the fields that changed (access_token / expiry),
  // so merge onto the stored tokens to keep the refresh_token around.
  client.on('tokens', (fresh) => {
    try {
      const current = JSON.parse(readFileSync(TOKEN_PATH, 'utf8'));
      writeFileSync(TOKEN_PATH, JSON.stringify({ ...current, ...fresh }, null, 2));
    } catch {
      /* best-effort persistence — a failed write must not break the API call */
    }
  });

  return client;
}

/** Normalize any thrown value into a readable string for error collection. */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}
