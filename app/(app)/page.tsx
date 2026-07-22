import { CalendarClock, MapPin, Sparkles, Star } from 'lucide-react';
import { auth } from '@/auth';
import { getEvents, getLatestRun, getProfile, getStats } from '@/lib/queries';
import { serializeEvent } from '@/lib/format';
import { EventsWorkspace } from '@/components/events-workspace';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const session = await auth();
  const [rows, stats, run, profile] = await Promise.all([
    getEvents({ timeframe: 'upcoming' }),
    getStats(),
    getLatestRun(),
    getProfile(),
  ]);

  const events = rows.map(serializeEvent);
  const name = profile?.displayName || session?.user?.name || 'there';

  const lastRunLabel = run?.finishedAt
    ? new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London',
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(run.finishedAt)
    : null;

  return (
    <div className="mx-auto max-w-6xl px-5 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          {greeting()}, {name}.
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {events.length > 0
            ? `${events.length} upcoming networking events, ranked by how much they'd move the needle for you.`
            : 'No upcoming events yet — the daily run will surface them here.'}
        </p>
      </div>

      {/* stat row */}
      <div className="mb-7 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat icon={<CalendarClock size={16} />} label="Upcoming" value={stats.upcomingCount} />
        <Stat icon={<Star size={16} />} label="You're going to" value={stats.goingCount} />
        <Stat icon={<Sparkles size={16} />} label="Attended" value={stats.attendedCount} />
        <div className="rounded-xl border border-border bg-card p-3.5 shadow-sm">
          <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <MapPin size={14} /> By region
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-sm">
            {Object.keys(stats.regionCounts).length === 0 && <span className="text-muted-foreground">—</span>}
            {Object.entries(stats.regionCounts).map(([r, c]) => (
              <span key={r} className="font-medium">
                {c} <span className="font-normal text-muted-foreground">{r.replace(' & Sussex', '')}</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      {lastRunLabel && (
        <p className="mb-4 text-xs text-muted-foreground">
          Last refreshed {lastRunLabel} · found {run?.eventsFound ?? 0}, kept {run?.eventsKept ?? 0}
        </p>
      )}

      <EventsWorkspace events={events} />
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3.5 shadow-sm">
      <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon} {label}
      </div>
      <div className="text-2xl font-semibold tracking-tight">{value}</div>
    </div>
  );
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}
