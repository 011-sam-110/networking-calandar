import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { Wordmark } from '@/components/wordmark';
import { ThemeToggle } from '@/components/theme-toggle';
import { SignOutButton } from '@/components/sign-out-button';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  return (
    <>
      <header className="sticky top-0 z-20 border-b border-border bg-[color-mix(in_srgb,var(--background)_85%,transparent)] backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
          <Wordmark />
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
        Orbit · found &amp; ranked as you, refreshed daily.
      </footer>
    </>
  );
}
