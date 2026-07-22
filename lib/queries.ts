import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  events,
  curations,
  attendance,
  notes,
  runs,
  profile,
  type EventRow,
  type CurationRow,
  type AttendanceRow,
  type NoteRow,
  type RunRow,
  type ProfileRow,
} from '@/db/schema';

export type EventWithDetails = EventRow & {
  curation: CurationRow | null;
  attendance: AttendanceRow | null;
  notes: NoteRow[];
};

/** Latest curation per event (Postgres DISTINCT ON). */
async function latestCurations(eventIds: string[]): Promise<Map<string, CurationRow>> {
  if (eventIds.length === 0) return new Map();
  const rows = await db
    .selectDistinctOn([curations.eventId])
    .from(curations)
    .where(inArray(curations.eventId, eventIds))
    .orderBy(curations.eventId, desc(curations.createdAt));
  return new Map(rows.map((c) => [c.eventId, c]));
}

export interface EventFilter {
  regions?: string[];
  timeframe?: 'upcoming' | 'past' | 'all';
  goingOnly?: boolean;
  includeDropped?: boolean;
}

export async function getEvents(filter: EventFilter = {}): Promise<EventWithDetails[]> {
  const { regions, timeframe = 'upcoming', goingOnly = false, includeDropped = false } = filter;

  const conds = [];
  if (regions && regions.length > 0) conds.push(inArray(events.region, regions));
  if (timeframe === 'upcoming') conds.push(gte(events.startAt, new Date()));
  if (timeframe === 'past') conds.push(lt(events.startAt, new Date()));

  const rows = await db.query.events.findMany({
    where: conds.length ? and(...conds) : undefined,
    with: { attendance: true, notes: { orderBy: (n, { desc: d }) => [d(n.createdAt)] } },
    orderBy: (e, { asc }) => [asc(e.startAt)],
  });

  const curMap = await latestCurations(rows.map((r) => r.id));

  let result: EventWithDetails[] = rows.map((r) => ({
    ...r,
    curation: curMap.get(r.id) ?? null,
    attendance: r.attendance ?? null,
    notes: r.notes ?? [],
  }));

  if (!includeDropped) {
    result = result.filter((e) => (e.curation ? e.curation.decision !== 'drop' : true));
  }
  if (goingOnly) {
    result = result.filter((e) => e.attendance?.going);
  }
  return result;
}

export async function getEventById(id: string): Promise<EventWithDetails | null> {
  const row = await db.query.events.findFirst({
    where: eq(events.id, id),
    with: { attendance: true, notes: { orderBy: (n, { desc: d }) => [d(n.createdAt)] } },
  });
  if (!row) return null;
  const curMap = await latestCurations([id]);
  return {
    ...row,
    curation: curMap.get(id) ?? null,
    attendance: row.attendance ?? null,
    notes: row.notes ?? [],
  };
}

export async function getLatestRun(): Promise<RunRow | null> {
  const [row] = await db.select().from(runs).orderBy(desc(runs.startedAt)).limit(1);
  return row ?? null;
}

export async function getProfile(): Promise<ProfileRow | null> {
  const [row] = await db.select().from(profile).where(eq(profile.id, 1)).limit(1);
  return row ?? null;
}

export interface DashboardStats {
  upcomingCount: number;
  goingCount: number;
  attendedCount: number;
  regionCounts: Record<string, number>;
}

export async function getStats(): Promise<DashboardStats> {
  const [{ count: upcomingCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(events)
    .where(gte(events.startAt, new Date()));

  const [{ count: goingCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(attendance)
    .where(eq(attendance.going, true));

  const [{ count: attendedCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(attendance)
    .where(eq(attendance.attended, true));

  const regionRows = await db
    .select({ region: events.region, count: sql<number>`count(*)::int` })
    .from(events)
    .where(gte(events.startAt, new Date()))
    .groupBy(events.region);

  const regionCounts: Record<string, number> = {};
  for (const r of regionRows) regionCounts[r.region] = r.count;

  return { upcomingCount, goingCount, attendedCount, regionCounts };
}
