import { cn } from '@/lib/utils';

export function Wordmark({ size = 'md' }: { size?: 'md' | 'lg' }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className={cn(
          'relative inline-flex items-center justify-center rounded-full',
          size === 'lg' ? 'h-9 w-9' : 'h-7 w-7',
        )}
        style={{
          background: 'radial-gradient(circle at 30% 30%, var(--london), #3a2fb0)',
        }}
        aria-hidden
      >
        <span className="absolute h-1.5 w-1.5 rounded-full bg-white" style={{ top: 3, right: 4 }} />
      </span>
      <span
        className={cn(
          'font-semibold tracking-tight text-foreground',
          size === 'lg' ? 'text-2xl' : 'text-lg',
        )}
      >
        Orbit
      </span>
    </div>
  );
}
