import { scoreBand } from '@/lib/format';

const toneColor: Record<string, string> = {
  high: 'var(--success)',
  mid: 'var(--london)',
  low: 'var(--muted-foreground)',
};

export function ScoreRing({ score, size = 44 }: { score: number | null; size?: number }) {
  const band = scoreBand(score);
  const value = score ?? 0;
  const stroke = 4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (value / 100) * c;
  const color = toneColor[band.tone];

  return (
    <div className="flex flex-col items-center" title={`${band.label} · ${score ?? '—'}/100`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--muted)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeDasharray={c}
          strokeDashoffset={score == null ? c : offset}
          strokeLinecap="round"
        />
      </svg>
      <span className="mt-[-1px] text-[11px] font-semibold" style={{ color }}>
        {score ?? '—'}
      </span>
    </div>
  );
}
