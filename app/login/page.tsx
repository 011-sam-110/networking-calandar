import { redirect } from 'next/navigation';
import { auth, googleEnabled } from '@/auth';
import { LoginForm } from '@/components/login-form';
import { Wordmark } from '@/components/wordmark';

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect('/');

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mb-4 flex justify-center">
            <Wordmark size="lg" />
          </div>
          <p className="text-sm text-muted-foreground">
            Networking events worth showing up for — found and ranked as you.
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <LoginForm googleEnabled={googleEnabled} />
        </div>
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Private, single-user. Only your account can sign in.
        </p>
      </div>
    </main>
  );
}
