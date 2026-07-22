import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import Credentials from 'next-auth/providers/credentials';

const allowedEmail = (process.env.ALLOWED_EMAIL ?? '').trim().toLowerCase();

const providers = [];

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.push(
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  );
}

// Single-user dev login (used when Google isn't configured, and for local dev).
providers.push(
  Credentials({
    id: 'dev',
    name: 'Password',
    credentials: { password: { label: 'Password', type: 'password' } },
    authorize: async (creds) => {
      const expected = process.env.DEV_LOGIN_PASSWORD;
      if (expected && creds?.password === expected) {
        return { id: 'sam', name: 'Sam', email: allowedEmail || 'sam@local' };
      }
      return null;
    },
  }),
);

export const googleEnabled = Boolean(
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
);

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers,
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  trustHost: true,
  callbacks: {
    async signIn({ user, account }) {
      // Dev password login is already gated by the shared secret.
      if (account?.provider === 'dev') return true;
      // Google: only the allowed account may in.
      if (!allowedEmail) return true;
      return (user.email ?? '').toLowerCase() === allowedEmail;
    },
  },
});
