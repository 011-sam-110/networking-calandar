'use client';

import { useEffect, useState, useTransition } from 'react';
import {
  Building2,
  Calendar,
  Check,
  Clock,
  ExternalLink,
  MapPin,
  Star,
  Ticket,
  Trash2,
  X,
} from 'lucide-react';
import type { ClientEvent } from '@/lib/format';
import { RegionBadge } from '@/components/region-badge';
import { ScoreRing } from '@/components/score-ring';
import { scoreBand } from '@/lib/format';
import { addNote, deleteNote, setAttended, setGoing } from '@/app/actions';
import { cn } from '@/lib/utils';

export function EventDetailDialog({
  event,
  onClose,
}: {
  event: ClientEvent | null;
  onClose: () => void;
}) {
  const [pending, start] = useTransition();
  const [noteText, setNoteText] = useState('');

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    if (event) {
      document.addEventListener('keydown', onKey);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [event, onClose]);

  if (!event) return null;
  const band = scoreBand(event.score);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-border bg-card p-6 shadow-xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <RegionBadge region={event.region} />
              {event.linkVerified && (
                <span className="inline-flex items-center gap-1 text-[11px] text-[var(--success)]">
                  <Check size={12} /> link checked
                </span>
              )}
              {event.isPast && <span className="text-[11px] text-muted-foreground">· past</span>}
            </div>
            <h2 className="text-xl font-semibold leading-tight">{event.title}</h2>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* meta */}
        <div className="mt-4 grid gap-2 text-sm">
          <div className="flex items-center gap-2 text-foreground/80">
            <Calendar size={15} className="text-muted-foreground" /> {event.whenLabel}
          </div>
          {!event.isOnline && (event.venueName || event.address) && (
            <div className="flex items-start gap-2 text-foreground/80">
              <MapPin size={15} className="mt-0.5 shrink-0 text-muted-foreground" />
              <span>{[event.venueName, event.address, event.city].filter(Boolean).join(', ')}</span>
            </div>
          )}
          {event.organizer && (
            <div className="flex items-center gap-2 text-foreground/80">
              <Building2 size={15} className="text-muted-foreground" /> {event.organizer}
            </div>
          )}
          {event.price && (
            <div className="flex items-center gap-2 text-foreground/80">
              <Ticket size={15} className="text-muted-foreground" /> {event.price}
            </div>
          )}
        </div>

        {event.description && (
          <p className="mt-4 text-sm leading-relaxed text-foreground/80">{event.description}</p>
        )}

        {event.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {event.tags.map((t) => (
              <span key={t} className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                {t}
              </span>
            ))}
          </div>
        )}

        {/* curation verdict */}
        {(event.rationale || event.score != null) && (
          <div className="mt-5 rounded-xl border border-border bg-accent/40 p-4">
            <div className="flex items-center gap-3">
              <ScoreRing score={event.score} size={48} />
              <div>
                <div className="text-sm font-semibold">{band.label}</div>
                <div className="text-xs text-muted-foreground">Orbit&apos;s take, as you</div>
              </div>
            </div>
            {event.rationale && <p className="mt-3 text-sm text-foreground/85">{event.rationale}</p>}
            {event.expectedPayoff && (
              <p className="mt-2 text-sm text-foreground/70">
                <span className="font-medium">Likely payoff — </span>
                {event.expectedPayoff}
              </p>
            )}
          </div>
        )}

        {/* actions */}
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <a
            href={event.bookingUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-[var(--radius)] bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            <ExternalLink size={15} /> Book tickets
          </a>
          <button
            onClick={() => start(() => setGoing(event.id, !event.going))}
            disabled={pending}
            className={cn(
              'inline-flex h-10 items-center gap-2 rounded-[var(--radius)] border px-4 text-sm font-medium transition-colors',
              event.going
                ? 'border-[var(--london)] bg-accent text-accent-foreground'
                : 'border-border bg-card text-foreground hover:bg-muted',
            )}
          >
            <Star size={15} className={event.going ? 'fill-current' : ''} />
            {event.going ? 'Going' : "I'm going"}
          </button>
        </div>

        {/* attendance tick / cross */}
        <div className="mt-4">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Clock size={13} /> Did you actually go? <span className="font-normal">(this teaches Orbit what to find)</span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => start(() => setAttended(event.id, event.attended === true ? null : true))}
              disabled={pending}
              className={cn(
                'inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius)] border text-sm font-medium transition-colors',
                event.attended === true
                  ? 'border-[var(--success)] bg-[color-mix(in_srgb,var(--success)_15%,transparent)] text-[var(--success)]'
                  : 'border-border bg-card text-muted-foreground hover:bg-muted',
              )}
            >
              <Check size={15} /> Attended
            </button>
            <button
              onClick={() => start(() => setAttended(event.id, event.attended === false ? null : false))}
              disabled={pending}
              className={cn(
                'inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius)] border text-sm font-medium transition-colors',
                event.attended === false
                  ? 'border-[var(--danger)] bg-[color-mix(in_srgb,var(--danger)_15%,transparent)] text-[var(--danger)]'
                  : 'border-border bg-card text-muted-foreground hover:bg-muted',
              )}
            >
              <X size={15} /> Didn&apos;t go
            </button>
          </div>
        </div>

        {/* notes */}
        <div className="mt-5">
          <div className="mb-2 text-xs font-medium text-muted-foreground">
            Your notes {event.notes.length > 0 && `(${event.notes.length})`}
          </div>
          <div className="space-y-2">
            {event.notes.map((n) => (
              <div key={n.id} className="group flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
                <span className="flex-1 whitespace-pre-wrap">{n.body}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{n.createdLabel}</span>
                <button
                  onClick={() => start(() => deleteNote(n.id))}
                  disabled={pending}
                  className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-[var(--danger)] group-hover:opacity-100"
                  aria-label="Delete note"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const body = noteText;
              if (!body.trim()) return;
              setNoteText('');
              start(() => addNote(event.id, body));
            }}
            className="mt-2 flex gap-2"
          >
            <input
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="e.g. great crowd, met 2 recruiters — go again"
              className="h-9 flex-1 rounded-[var(--radius)] border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              type="submit"
              disabled={pending || !noteText.trim()}
              className="inline-flex h-9 items-center rounded-[var(--radius)] bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              Add
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
