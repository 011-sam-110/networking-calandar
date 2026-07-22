import { regionMeta } from '@/lib/format';
import { cn } from '@/lib/utils';

export function RegionBadge({ region, className }: { region: string; className?: string }) {
  const { label, varName } = regionMeta(region);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-0.5 text-xs font-medium',
        className,
      )}
    >
      <span className="h-2 w-2 rounded-full" style={{ background: `var(${varName})` }} />
      {label}
    </span>
  );
}
