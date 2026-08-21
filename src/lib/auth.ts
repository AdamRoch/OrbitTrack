import { getServerSession, type NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { findUserByEmail, getDb, provisionGoogleUser } from "./db";
import { deliverPendingNotifications } from "./notifications";

declare module "next-auth" {
  interface Session {
    user: { id: string; ownerId: number; isAdmin: boolean; email?: string | null; name?: string | null };
  }
}

declare module "next-auth/jwt" {
  interface JWT { ownerId?: number; isAdmin?: boolean; }
}

/** Browser identity only. Agents use account-scoped bearer credentials instead. */
export const authOptions: NextAuthOptions = {
  providers: [GoogleProvider({ clientId: process.env.GOOGLE_CLIENT_ID ?? "", clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "" })],
  pages: { signIn: "/signin", error: "/signin" },
  session: { strategy: "jwt" },
  secret: process.env.NEXTAUTH_SECRET ?? (process.env.NODE_ENV === "production" ? undefined : "orbittrack-local-dev-session-secret"),
  callbacks: {
    async signIn({ account, profile }) {
      const email = typeof profile?.email === "string" ? profile.email.toLowerCase() : null;
      const verified = (profile as { email_verified?: unknown } | undefined)?.email_verified === true;
      if (!email || !verified || !account?.providerAccountId) return false;
      const result = provisionGoogleUser(email, account.providerAccountId, typeof profile?.name === "string" ? profile.name : null);
      if (result.kind === "full" || result.kind === "closed") {
        return `/api/auth/denied?reason=${result.kind}`;
      }
      if (result.kind === "created") void deliverPendingNotifications();
      return result.kind !== "identity_conflict";
    },
    async jwt({ token, account, profile }) {
      if (account?.provider === "google" && typeof profile?.email === "string") {
        const user = findUserByEmail(getDb(), profile.email);
        if (user) { token.ownerId = user.id; token.isAdmin = user.isAdmin; }
      }
      return token;
    },
    async session({ session, token }) {
      if (!token.ownerId) throw new Error("authenticated session has no workspace");
      session.user = { id: token.sub ?? String(token.ownerId), ownerId: token.ownerId, isAdmin: Boolean(token.isAdmin), email: session.user?.email, name: session.user?.name };
      return session;
    },
  },
};

export function getBrowserSession() { return getServerSession(authOptions); }
