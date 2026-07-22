/**
 * One-time Google OAuth setup for the local runner.
 *
 *   npm run google:auth
 *
 * Spins up a tiny loopback server on port 5858, opens (or prints) the Google
 * consent URL, captures the returned authorization code, exchanges it for
 * tokens, and writes them to runner/.google-token.json. Because we request
 * offline access with prompt=consent, Google returns a refresh token that the
 * runner can use indefinitely.
 */
import 'dotenv/config';
import http from 'node:http';
import { exec } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import {
  buildOAuthClient,
  hasGoogleCreds,
  REDIRECT_URI,
  SCOPES,
  TOKEN_PATH,
} from './google-client';

const PORT = 5858;

function openBrowser(url: string): void {
  const platform = process.platform;
  const cmd =
    platform === 'win32'
      ? `start "" "${url}"`
      : platform === 'darwin'
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, () => {
    /* ignore failures — the URL is printed to the console as a fallback */
  });
}

function page(title: string, body: string): string {
  return (
    `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
    `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:32rem;` +
    `margin:4rem auto;text-align:center;color:#111827;">` +
    `<h1 style="font-size:1.4rem;">${title}</h1>` +
    `<p style="color:#4b5563;">${body}</p></div>`
  );
}

function shutdown(server: http.Server, code: number): void {
  server.close(() => process.exit(code));
  // Fallback in case a keep-alive socket holds the server open.
  setTimeout(() => process.exit(code), 500).unref();
}

function main(): void {
  if (!hasGoogleCreds()) {
    console.error('\nGoogle credentials are not set.');
    console.error(
      'Create an OAuth client (type "Web application") in the Google Cloud Console, then add to .env:',
    );
    console.error('  GOOGLE_CLIENT_ID=...');
    console.error('  GOOGLE_CLIENT_SECRET=...');
    console.error(`\nAlso add this redirect URI to that OAuth client:\n  ${REDIRECT_URI}\n`);
    process.exit(1);
    return;
  }

  const client = buildOAuthClient();
  const authUrl = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', REDIRECT_URI);
      if (url.pathname !== '/oauth2callback') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }

      const err = url.searchParams.get('error');
      if (err) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(page('Authorization failed', `Google returned: ${err}`));
        console.error(`\nAuthorization failed: ${err}`);
        shutdown(server, 1);
        return;
      }

      const code = url.searchParams.get('code');
      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(page('Missing code', 'No authorization code was provided.'));
        return;
      }

      const { tokens } = await client.getToken(code);
      writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        page('All set', 'Tokens saved. You can close this tab and return to the terminal.'),
      );
      console.log(`\nSaved Google tokens to ${TOKEN_PATH}`);
      if (!tokens.refresh_token) {
        console.warn(
          '\nWarning: no refresh_token was returned. Revoke this app at ' +
            'https://myaccount.google.com/permissions and run `npm run google:auth` again.',
        );
      }
      shutdown(server, 0);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/html' });
      res.end(page('Token exchange failed', String(e)));
      console.error('\nToken exchange failed:', e);
      shutdown(server, 1);
    }
  });

  server.on('error', (e: NodeJS.ErrnoException) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`\nPort ${PORT} is already in use. Close whatever is using it and retry.`);
    } else {
      console.error('\nLocal server error:', e.message);
    }
    process.exit(1);
  });

  server.listen(PORT, () => {
    console.log('\nGoogle authorization — one-time setup');
    console.log('-------------------------------------');
    console.log('1. A browser tab should open. If it does not, open this URL manually:\n');
    console.log('   ' + authUrl + '\n');
    console.log('2. Approve the Calendar + Gmail-send permissions.');
    console.log(`3. You will be redirected back to ${REDIRECT_URI} and the token will be saved.\n`);
    console.log(`Listening on http://localhost:${PORT} …`);
    openBrowser(authUrl);
  });
}

main();
