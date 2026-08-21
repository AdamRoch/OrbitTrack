import { SignInWithGoogleButton } from "@/components/auth-buttons";
import { UfoIcon } from "@/components/icons";
import { getBrowserSession } from "@/lib/auth";
import { redirect } from "next/navigation";

const ERROR_MESSAGES: Record<string, string> = {
  AccessDenied: "This Google account does not have access to an OrbitTrack workspace.",
  OAuthCallback: "Google sign-in could not be completed. Please try again.",
  OAuthSignin: "Google sign-in could not be started. Please try again.",
  RegistrationClosed: "New OrbitTrack registrations are currently closed. Existing users can still sign in.",
  RegistrationFull: "OrbitTrack has reached its current account limit. Existing users can still sign in.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (await getBrowserSession()) redirect("/");

  const errorCode = (await searchParams).error;
  const message =
    typeof errorCode === "string"
      ? ERROR_MESSAGES[errorCode] ?? "Sign-in failed. Please try again."
      : null;

  return (
    <main className="relative z-10 mx-auto flex min-h-screen w-full max-w-md items-center px-5 py-12">
      <section className="glass glow-edge w-full rounded-[2rem] p-2">
        <div className="glass-core px-7 py-9 text-center sm:px-10">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[var(--accent)]/12 text-[var(--accent)] ring-1 ring-[var(--accent)]/35 shadow-[0_0_30px_-8px_rgba(var(--glow),0.8)]">
            <UfoIcon className="h-7 w-7" />
          </span>
          <p className="mt-5 font-mono text-[0.65rem] uppercase tracking-[0.24em] text-[var(--accent)]">
            Workspace access
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[var(--foreground)] text-glow">
            Welcome to OrbitTrack
          </h1>
          <p className="mx-auto mt-3 max-w-xs text-sm leading-6 text-[var(--foreground-muted)]">
            Sign in with your Google account to return to your tickets and agent workspace.
          </p>

          {message && (
            <p role="alert" className="mt-5 rounded-xl border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-4 py-3 text-sm text-[#ffb4c0]">
              {message}
            </p>
          )}

          <div className="mt-7">
            <SignInWithGoogleButton />
          </div>
          <p className="mt-5 text-xs leading-5 text-[var(--foreground-subtle)]">
            OrbitTrack uses Google only to verify your account. Agents authenticate separately with workspace credentials.
          </p>
        </div>
      </section>
    </main>
  );
}
