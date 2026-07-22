/**
 * Daily digest email for the local runner.
 *
 * getEmailSender() returns a real Gmail sender when creds + a saved token are
 * present, otherwise a mock that writes the rendered HTML to disk. Rendering
 * (renderDigestHtml / renderDigestText) is pure and dependency-free so it can
 * be tested and previewed without touching Google at all.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import { google } from 'googleapis';
import type { DigestEvent, DigestPayload, EmailSender } from '../lib/types';
import {
  errorMessage,
  getOAuthClient,
  hasGoogleCreds,
  hasGoogleToken,
} from './google-client';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* -------------------------------- rendering -------------------------------- */

function esc(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Format an ISO timestamp readably in a fixed timezone. Fixing the timezone
 * (Europe/London, matching the calendar) keeps output deterministic regardless
 * of the machine's local zone.
 */
function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/London',
  }).format(d);
}

/** Format a date-only string (e.g. "2026-07-22") for the header. */
function formatDateOnly(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/London',
  }).format(d);
}

function venueLine(ev: DigestEvent): string {
  return [ev.venueName, ev.city]
    .filter((p): p is string => Boolean(p && p.trim()))
    .map((p) => p.trim())
    .join(', ');
}

function scoreBadge(score: number): string {
  const s = Math.round(score);
  return (
    `<span style="display:inline-block;background:#eef2ff;color:#3730a3;` +
    `border-radius:999px;padding:3px 10px;font-size:12px;font-weight:600;` +
    `white-space:nowrap;">Score ${esc(String(s))}</span>`
  );
}

function bookButton(url: string, label: string): string {
  return (
    `<a href="${esc(url)}" style="display:inline-block;background:#4f46e5;` +
    `color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;` +
    `padding:11px 20px;border-radius:8px;">${esc(label)} &rarr;</a>`
  );
}

function eventCard(ev: DigestEvent): string {
  const when = esc(formatWhen(ev.startAt));
  const region = esc(ev.region);
  const venue = venueLine(ev);
  const price = ev.price && ev.price.trim() ? esc(ev.price.trim()) : '';
  const rationale = ev.rationale && ev.rationale.trim() ? esc(ev.rationale.trim()) : '';

  return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="border:1px solid #e5e7eb;border-radius:12px;background:#ffffff;margin:0 0 16px;">
        <tr><td style="padding:18px 20px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="font-size:17px;font-weight:700;color:#111827;line-height:1.35;">${esc(ev.title)}</td>
              <td align="right" style="vertical-align:top;padding-left:10px;">${scoreBadge(ev.score)}</td>
            </tr>
          </table>
          <div style="color:#6b7280;font-size:13px;margin-top:8px;">${when} &middot; ${region}</div>
          ${venue ? `<div style="color:#374151;font-size:14px;margin-top:6px;">${esc(venue)}</div>` : ''}
          ${price ? `<div style="color:#374151;font-size:14px;margin-top:2px;">${price}</div>` : ''}
          ${
            rationale
              ? `<div style="color:#4b5563;font-size:14px;line-height:1.55;margin-top:12px;font-style:italic;">${rationale}</div>`
              : ''
          }
          <div style="margin-top:16px;">${bookButton(ev.bookingUrl, 'Book / Register')}</div>
        </td></tr>
      </table>`;
}

function sectionHeading(text: string): string {
  return (
    `<h2 style="font-size:14px;font-weight:700;letter-spacing:0.04em;` +
    `text-transform:uppercase;color:#6b7280;margin:26px 0 14px;">${esc(text)}</h2>`
  );
}

function emptyNote(text: string): string {
  return `<p style="color:#9ca3af;font-size:14px;margin:0 0 8px;">${esc(text)}</p>`;
}

/** Pure, dependency-free responsive HTML email. */
export function renderDigestHtml(payload: DigestPayload): string {
  const dateLabel = esc(formatDateOnly(payload.date));

  const newCards = payload.newEvents.length
    ? payload.newEvents.map(eventCard).join('\n')
    : emptyNote('No new events found today.');

  const upcomingCards = payload.upcoming.length
    ? payload.upcoming.map(eventCard).join('\n')
    : emptyNote("Nothing on your calendar yet.");

  const s = payload.runSummary;
  const footer =
    `Scanned ${esc(String(s.found))} events, kept ${esc(String(s.kept))} — ` +
    `window ${esc(s.coveredFrom)} to ${esc(s.coveredTo)}.`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>Networking digest — ${dateLabel}</title>
  <style>
    body { margin:0; padding:0; background:#f3f4f6; }
    a { color:#4f46e5; }
    @media only screen and (max-width:620px) {
      .container { width:100% !important; }
      .gutter { padding-left:16px !important; padding-right:16px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0"
             style="width:600px;max-width:600px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">

        <!-- header -->
        <tr><td class="gutter" style="padding:4px 24px 8px;">
          <div style="font-size:13px;font-weight:600;color:#4f46e5;letter-spacing:0.06em;text-transform:uppercase;">Networking digest</div>
          <div style="font-size:22px;font-weight:800;color:#111827;margin-top:4px;">${dateLabel}</div>
        </td></tr>

        <!-- new events -->
        <tr><td class="gutter" style="padding:0 24px;">
          ${sectionHeading('New events found')}
          ${newCards}
        </td></tr>

        <!-- upcoming -->
        <tr><td class="gutter" style="padding:0 24px;">
          ${sectionHeading("Upcoming — you're going")}
          ${upcomingCards}
        </td></tr>

        <!-- footer -->
        <tr><td class="gutter" style="padding:20px 24px 8px;">
          <div style="border-top:1px solid #e5e7eb;padding-top:14px;color:#9ca3af;font-size:12px;line-height:1.5;">
            ${footer}
          </div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function eventTextLines(ev: DigestEvent): string[] {
  const out: string[] = [''];
  out.push(`* ${ev.title}  [score ${Math.round(ev.score)}]`);
  out.push(`  ${formatWhen(ev.startAt)} · ${ev.region}`);
  const venue = venueLine(ev);
  if (venue) out.push(`  ${venue}`);
  if (ev.price && ev.price.trim()) out.push(`  ${ev.price.trim()}`);
  if (ev.rationale && ev.rationale.trim()) out.push(`  ${ev.rationale.trim()}`);
  out.push(`  Book: ${ev.bookingUrl}`);
  return out;
}

/** Plain-text fallback for the digest. */
export function renderDigestText(payload: DigestPayload): string {
  const lines: string[] = [];
  lines.push(`Networking digest — ${formatDateOnly(payload.date)}`);
  lines.push('');
  lines.push('NEW EVENTS FOUND');
  lines.push('================');
  if (!payload.newEvents.length) lines.push('(none today)');
  for (const ev of payload.newEvents) lines.push(...eventTextLines(ev));
  lines.push('');
  lines.push("UPCOMING — YOU'RE GOING");
  lines.push('=======================');
  if (!payload.upcoming.length) lines.push('(nothing scheduled)');
  for (const ev of payload.upcoming) lines.push(...eventTextLines(ev));
  lines.push('');
  const s = payload.runSummary;
  lines.push(
    `Run summary: scanned ${s.found}, kept ${s.kept}, window ${s.coveredFrom} to ${s.coveredTo}.`,
  );
  return lines.join('\n');
}

/* --------------------------------- sending --------------------------------- */

// A fixed boundary is safe here: both MIME parts are base64-encoded, so the
// boundary string can never appear inside a part body.
const MIME_BOUNDARY = 'nc_digest_boundary_c3a1f0e2b7d4';

/** RFC 2047 encode a subject only when it contains non-ASCII characters. */
function encodeSubject(subject: string): string {
  if (/^[\x20-\x7e]*$/.test(subject)) return subject;
  return `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`;
}

/** base64 encode, wrapped at 76 chars per RFC 2045. */
function b64Body(s: string): string {
  return Buffer.from(s, 'utf8')
    .toString('base64')
    .replace(/.{76}/g, '$&\r\n');
}

/** Build a base64url RFC822 multipart/alternative message for Gmail's API. */
function buildRawMessage(payload: DigestPayload): string {
  const html = renderDigestHtml(payload);
  const text = renderDigestText(payload);
  const subject = encodeSubject(`Networking digest — ${payload.date}`);

  const mime = [
    `To: ${payload.to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${MIME_BOUNDARY}"`,
    '',
    `--${MIME_BOUNDARY}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    b64Body(text),
    '',
    `--${MIME_BOUNDARY}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    b64Body(html),
    '',
    `--${MIME_BOUNDARY}--`,
    '',
  ].join('\r\n');

  return Buffer.from(mime, 'utf8').toString('base64url');
}

const gmailSender: EmailSender = {
  name: 'gmail',
  async send(payload) {
    try {
      const auth = await getOAuthClient();
      const gmail = google.gmail({ version: 'v1', auth });
      const raw = buildRawMessage(payload);
      const res = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
      return { ok: true, id: res.data.id ?? undefined };
    } catch (e) {
      return { ok: false, error: errorMessage(e) };
    }
  },
};

const consoleSender: EmailSender = {
  name: 'console',
  async send(payload) {
    try {
      const html = renderDigestHtml(payload);
      const dir = path.join(HERE, 'out');
      mkdirSync(dir, { recursive: true });
      const outPath = path.join(dir, 'last-digest.html');
      writeFileSync(outPath, html, 'utf8');
      console.log(`[console] wrote digest for ${payload.to} -> ${outPath}`);
      return { ok: true, id: 'mock' };
    } catch (e) {
      return { ok: false, error: errorMessage(e) };
    }
  },
};

/** Real Gmail sender when configured, otherwise a file-writing mock. */
export function getEmailSender(): EmailSender {
  if (hasGoogleCreds() && hasGoogleToken()) return gmailSender;
  return consoleSender;
}
