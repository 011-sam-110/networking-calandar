import type { EventWithDetails } from './queries';

const TZ = 'Europe/London';

const parts = (d: Date, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: TZ, ...opts }).format(d);

/** yyyy-mm-dd in Europe/London, for calendar-day grouping. */
export function dateKey(d: Date): string {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
  return p; // en-CA gives yyyy-mm-dd
}

export interface ClientNote {
  id: string;
  body: string;
  createdLabel: string;
}

export interface ClientEvent {
  id: string;
  title: string;
  description: string;
  startISO: string;
  endISO: string | null;
  dateKey: string;
  whenLabel: string;
  weekday: string;
  dayNum: string;
  monthShort: string;
  timeLabel: string;
  region: string;
  venueName: string | null;
  city: string | null;
  address: string | null;
  isOnline: boolean;
  bookingUrl: string;
  linkVerified: boolean;
  price: string | null;
  organizer: string | null;
  tags: string[];
  source: string;
  score: number | null;
  decision: string | null;
  rationale: string | null;
  expectedPayoff: string | null;
  going: boolean;
  attended: boolean | null;
  notes: ClientNote[];
  isPast: boolean;
}

export function serializeEvent(e: EventWithDetails): ClientEvent {
  const start = e.startAt instanceof Date ? e.startAt : new Date(e.startAt);
  const end = e.endAt ? (e.endAt instanceof Date ? e.endAt : new Date(e.endAt)) : null;
  const weekday = parts(start, { weekday: 'short' });
  const dayNum = parts(start, { day: 'numeric' });
  const monthShort = parts(start, { month: 'short' });
  const timeLabel = parts(start, { hour: '2-digit', minute: '2-digit', hour12: false });

  return {
    id: e.id,
    title: e.title,
    description: e.description,
    startISO: start.toISOString(),
    endISO: end ? end.toISOString() : null,
    dateKey: dateKey(start),
    whenLabel: `${weekday} ${dayNum} ${monthShort} · ${timeLabel}`,
    weekday,
    dayNum,
    monthShort,
    timeLabel,
    region: e.region,
    venueName: e.venueName,
    city: e.city,
    address: e.address,
    isOnline: e.isOnline,
    bookingUrl: e.bookingUrl,
    linkVerified: e.linkVerified,
    price: e.price,
    organizer: e.organizer,
    tags: e.tags ?? [],
    source: e.source,
    score: e.curation?.score ?? null,
    decision: e.curation?.decision ?? null,
    rationale: e.curation?.rationale ?? null,
    expectedPayoff: e.curation?.expectedPayoff ?? null,
    going: e.attendance?.going ?? false,
    attended: e.attendance?.attended ?? null,
    notes: (e.notes ?? []).map((n) => {
      const c = n.createdAt instanceof Date ? n.createdAt : new Date(n.createdAt);
      return {
        id: n.id,
        body: n.body,
        createdLabel: parts(c, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }),
      };
    }),
    isPast: start.getTime() < Date.now(),
  };
}

export const REGIONS = ['Brighton & Sussex', 'London', 'UK'] as const;

export function regionMeta(region: string): { label: string; varName: string } {
  switch (region) {
    case 'Brighton & Sussex':
      return { label: 'Brighton', varName: '--brighton' };
    case 'London':
      return { label: 'London', varName: '--london' };
    default:
      return { label: 'UK', varName: '--uk' };
  }
}

export function scoreBand(score: number | null): { label: string; tone: 'high' | 'mid' | 'low' } {
  if (score == null) return { label: '—', tone: 'low' };
  if (score >= 75) return { label: 'Strong pick', tone: 'high' };
  if (score >= 55) return { label: 'Worth it', tone: 'mid' };
  return { label: 'Maybe', tone: 'low' };
}
