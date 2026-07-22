'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { Button } from '@/components/ui/button';

export function LoginForm({ googleEnabled }: { googleEnabled: boolean }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleDevLogin(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await signIn('dev', { password, redirect: false });
    setPending(false);
    if (res?.error) {
      setError('Wrong password.');
    } else {
      // Always land on this app's own origin — never trust res.url, which can
      // resolve to the wrong host (e.g. localhost) behind Vercel's proxy.
      window.location.href = '/';
    }
  }

  return (
    <div className="w-full max-w-sm">
      {googleEnabled && (
        <>
          <Button
            variant="outline"
            className="w-full h-11"
            onClick={() => signIn('google', { callbackUrl: '/' })}
          >
            <GoogleIcon /> Sign in with Google
          </Button>
          <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
            <div className="h-px flex-1 bg-border" />
            or
            <div className="h-px flex-1 bg-border" />
          </div>
        </>
      )}

      <form onSubmit={handleDevLogin} className="space-y-3">
        <label className="block text-sm font-medium">Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter your password"
          className="w-full h-11 rounded-[var(--radius)] border border-input bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          autoFocus
        />
        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
        <Button type="submit" className="w-full h-11" disabled={pending}>
          {pending ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z"
      />
    </svg>
  );
}
