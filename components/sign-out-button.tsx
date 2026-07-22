'use client';

import { signOut } from 'next-auth/react';
import { LogOut } from 'lucide-react';

export function SignOutButton() {
  return (
    <button
      onClick={() => signOut({ callbackUrl: '/login' })}
      className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius)] border border-border bg-card px-3 text-sm text-muted-foreground hover:bg-muted transition-colors cursor-pointer"
    >
      <LogOut size={15} /> Sign out
    </button>
  );
}
