'use client';

import { Check, MapPin, Star, Ticket, X } from 'lucide-react';
import type { ClientEvent } from '@/lib/format';
import { RegionBadge } from '@/components/region-badge';
import { ScoreRing } from '@/components/score-ring';
import { cn } from '@/lib/utils';

export function EventCard({
  event,
  onOpen,
  onToggleGoing,
}: {
  event: ClientEvent;
  onOpen: (e: ClientEvent) => void;
  onToggleGoing: (e: ClientEvent) => void;
}) {
  return (
    <div
      onClick={() => onOpen(event)}
      className="group flex cursor-pointer gap-4 rounded-2xl border border-border bg-card p-4 shadow-sm transition-all hover:border-[var(--london)] hover:shadow-md"
    >
      {/* date block */}
      <div className="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-xl bg-muted text-center">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {event.weekday}
        </span>
        <span className="text-2xl font-semibold leading-none">{event.dayNum}</span>
        <span className="text-[11px] font-medium uppercase text-muted-foreground">{event.monthShort}</span>
      </div>

      {/* body */}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <h3 className="truncate text-[15px] font-semibold leading-snug">{event.title}</h3>
          <div className="shrink-0">
            <ScoreRing score={event.score} size={40} />
          </div>
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <RegionBadge region={event.region} />
          <span className="inline-flex items-center gap-1">
            <MapPin size={12} />
            {event.isOnline ? 'Online' : event.venueName || event.city || '—'}
          </span>
          <span>· {event.timeLabel}</span>
          {event.price && <span>· {event.price}</span>}
        </div>

        {event.rationale && (
          <p className="mt-2 line-clamp-2 text-sm text-foreground/80">
            <span className="font-medium text-[var(--london)]">Why go — </span>
            {event.rationale}
          </p>
        )}

        <div className="mt-3 flex items-center gap-2">
          <a
            href={event.bookingUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90"
          >
            <Ticket size={13} /> Book
          </a>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleGoing(event);
            }}
            className={cn(
              'inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors',
              event.going
                ? 'border-[var(--london)] bg-accent text-accent-foreground'
                : 'border-border bg-card text-muted-foreground hover:bg-muted',
            )}
          >
            <Star size={13} className={event.going ? 'fill-current' : ''} />
            {event.going ? 'Going' : "I'm going"}
          </button>

          {event.attended === true && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--success)]">
              <Check size={14} /> Attended
            </span>
          )}
          {event.attended === false && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <X size={14} /> Missed
            </span>
          )}

          {event.notes.length > 0 && (
            <span className="ml-auto text-xs text-muted-foreground">
              {event.notes.length} note{event.notes.length > 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
