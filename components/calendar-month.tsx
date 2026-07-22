'use client';

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ClientEvent } from '@/lib/format';
import { dateKey, regionMeta } from '@/lib/format';
import { cn } from '@/lib/utils';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function CalendarMonth({
  events,
  onOpen,
}: {
  events: ClientEvent[];
  onOpen: (e: ClientEvent) => void;
}) {
  const byDay = useMemo(() => {
    const m = new Map<string, ClientEvent[]>();
    for (const e of events) {
      const arr = m.get(e.dateKey) ?? [];
      arr.push(e);
      m.set(e.dateKey, arr);
    }
    return m;
  }, [events]);

  const initial = useMemo(() => {
    const first = [...events].sort((a, b) => a.startISO.localeCompare(b.startISO))[0];
    const d = first ? new Date(first.startISO) : new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  }, [events]);

  const [cursor, setCursor] = useState(initial);
  const todayKey = dateKey(new Date());

  const cells = useMemo(() => {
    const firstOfMonth = new Date(cursor.year, cursor.month, 1);
    const jsDay = firstOfMonth.getDay(); // 0=Sun
    const lead = (jsDay + 6) % 7; // Monday-first offset
    const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();
    const out: (Date | null)[] = [];
    for (let i = 0; i < lead; i++) out.push(null);
    for (let d = 1; d <= daysInMonth; d++) out.push(new Date(cursor.year, cursor.month, d));
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [cursor]);

  function shift(delta: number) {
    setCursor((c) => {
      const m = c.month + delta;
      return { year: c.year + Math.floor(m / 12), month: ((m % 12) + 12) % 12 };
    });
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          {MONTHS[cursor.month]} {cursor.year}
        </h3>
        <div className="flex gap-1">
          <button onClick={() => shift(-1)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted" aria-label="Previous month">
            <ChevronLeft size={16} />
          </button>
          <button onClick={() => setCursor(initial)} className="rounded-lg px-2 text-xs text-muted-foreground hover:bg-muted">
            Today
          </button>
          <button onClick={() => shift(1)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted" aria-label="Next month">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {WEEKDAYS.map((w) => (
          <div key={w} className="pb-1 text-center text-[11px] font-medium text-muted-foreground">
            {w}
          </div>
        ))}
        {cells.map((d, i) => {
          if (!d) return <div key={i} className="min-h-[74px] rounded-lg" />;
          const key = dateKey(d);
          const dayEvents = byDay.get(key) ?? [];
          const isToday = key === todayKey;
          return (
            <div
              key={i}
              className={cn(
                'min-h-[74px] rounded-lg border border-transparent p-1',
                dayEvents.length ? 'bg-muted/50' : '',
                isToday && 'border-[var(--london)] bg-accent/40',
              )}
            >
              <div className={cn('mb-0.5 px-1 text-[11px]', isToday ? 'font-semibold text-[var(--london)]' : 'text-muted-foreground')}>
                {d.getDate()}
              </div>
              <div className="space-y-0.5">
                {dayEvents.slice(0, 3).map((e) => {
                  const { varName } = regionMeta(e.region);
                  return (
                    <button
                      key={e.id}
                      onClick={() => onOpen(e)}
                      className="flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[11px] hover:bg-card"
                    >
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: `var(${varName})` }} />
                      <span className="truncate">{e.title}</span>
                    </button>
                  );
                })}
                {dayEvents.length > 3 && (
                  <div className="px-1 text-[10px] text-muted-foreground">+{dayEvents.length - 3} more</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
