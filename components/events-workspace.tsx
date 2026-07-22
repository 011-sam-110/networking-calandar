'use client';

import { useMemo, useState, useTransition } from 'react';
import { CalendarDays, LayoutList, Star } from 'lucide-react';
import type { ClientEvent } from '@/lib/format';
import { REGIONS, regionMeta } from '@/lib/format';
import { EventCard } from '@/components/event-card';
import { CalendarMonth } from '@/components/calendar-month';
import { EventDetailDialog } from '@/components/event-detail-dialog';
import { setGoing } from '@/app/actions';
import { cn } from '@/lib/utils';

export function EventsWorkspace({ events }: { events: ClientEvent[] }) {
  const [view, setView] = useState<'feed' | 'calendar'>('feed');
  const [regions, setRegions] = useState<Set<string>>(new Set());
  const [goingOnly, setGoingOnly] = useState(false);
  const [sort, setSort] = useState<'score' | 'date'>('score');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [, start] = useTransition();

  const filtered = useMemo(() => {
    let list = events;
    if (regions.size) list = list.filter((e) => regions.has(e.region));
    if (goingOnly) list = list.filter((e) => e.going);
    return list;
  }, [events, regions, goingOnly]);

  const feed = useMemo(() => {
    const list = [...filtered];
    if (sort === 'score') {
      list.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.startISO.localeCompare(b.startISO));
    } else {
      list.sort((a, b) => a.startISO.localeCompare(b.startISO));
    }
    return list;
  }, [filtered, sort]);

  const selected = selectedId ? events.find((e) => e.id === selectedId) ?? null : null;

  function toggleRegion(r: string) {
    setRegions((prev) => {
      const next = new Set(prev);
      next.has(r) ? next.delete(r) : next.add(r);
      return next;
    });
  }

  return (
    <div>
      {/* controls */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-[var(--radius)] border border-border bg-card p-0.5">
          <ViewBtn active={view === 'feed'} onClick={() => setView('feed')} icon={<LayoutList size={15} />} label="Feed" />
          <ViewBtn active={view === 'calendar'} onClick={() => setView('calendar')} icon={<CalendarDays size={15} />} label="Calendar" />
        </div>

        <div className="mx-1 h-6 w-px bg-border" />

        {REGIONS.map((r) => {
          const { label, varName } = regionMeta(r);
          const on = regions.has(r);
          return (
            <button
              key={r}
              onClick={() => toggleRegion(r)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                on ? 'border-transparent text-white' : 'border-border bg-card text-muted-foreground hover:bg-muted',
              )}
              style={on ? { background: `var(${varName})` } : undefined}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: on ? '#fff' : `var(${varName})` }} />
              {label}
            </button>
          );
        })}

        <button
          onClick={() => setGoingOnly((v) => !v)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
            goingOnly ? 'border-[var(--london)] bg-accent text-accent-foreground' : 'border-border bg-card text-muted-foreground hover:bg-muted',
          )}
        >
          <Star size={13} className={goingOnly ? 'fill-current' : ''} /> Going
        </button>

        {view === 'feed' && (
          <div className="ml-auto flex rounded-[var(--radius)] border border-border bg-card p-0.5 text-xs">
            <ViewBtn small active={sort === 'score'} onClick={() => setSort('score')} label="Top picks" />
            <ViewBtn small active={sort === 'date'} onClick={() => setSort('date')} label="By date" />
          </div>
        )}
      </div>

      {/* body */}
      {view === 'feed' ? (
        feed.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid gap-3">
            {feed.map((e) => (
              <EventCard
                key={e.id}
                event={e}
                onOpen={setSelectedId ? (ev) => setSelectedId(ev.id) : () => {}}
                onToggleGoing={(ev) => start(() => setGoing(ev.id, !ev.going))}
              />
            ))}
          </div>
        )
      ) : (
        <CalendarMonth events={filtered} onOpen={(e) => setSelectedId(e.id)} />
      )}

      <EventDetailDialog event={selected} onClose={() => setSelectedId(null)} />
    </div>
  );
}

function ViewBtn({
  active,
  onClick,
  icon,
  label,
  small,
}: {
  active: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  label: string;
  small?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-[calc(var(--radius)-2px)] font-medium transition-colors',
        small ? 'px-2.5 py-1' : 'px-3 py-1.5 text-sm',
        active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card/50 py-16 text-center">
      <p className="text-sm font-medium">No events match your filters</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Try clearing a filter, or wait for the next daily run to surface more.
      </p>
    </div>
  );
}
