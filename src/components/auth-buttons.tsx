"use client";

import { signIn, signOut } from "next-auth/react";
import { useState } from "react";
import { cn } from "@/lib/cn";

export function SignInWithGoogleButton() {
  const [pending, setPending] = useState(false);

  async function beginSignIn() {
    setPending(true);
    try {
      await signIn("google", { callbackUrl: "/" });
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={beginSignIn}
      className="group flex min-h-12 w-full items-center justify-center gap-3 rounded-full bg-white px-5 py-3 text-sm font-semibold text-[#111827] shadow-[0_14px_40px_-22px_rgba(255,255,255,0.8)] transition hover:bg-[#f4f7fb] disabled:cursor-wait disabled:opacity-70"
    >
      <GoogleIcon className="h-5 w-5 shrink-0" />
      {pending ? "Connecting..." : "Sign in with Google"}
    </button>
  );
}

export function SignOutButton({ mobile = false }: { mobile?: boolean }) {
  const [pending, setPending] = useState(false);

  async function beginSignOut() {
    setPending(true);
    try {
      await signOut({ callbackUrl: "/signin" });
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={beginSignOut}
      className={cn(
        "rounded-full text-[--foreground-muted] transition-colors hover:text-[--foreground] disabled:cursor-wait disabled:opacity-60",
        mobile
          ? "mt-2 px-6 py-3 text-base"
          : "ml-1 hidden px-3 py-1.5 text-sm md:inline-flex",
      )}
    >
      {pending ? "Signing out..." : "Sign out"}
    </button>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path fill="#EA4335" d="M5.27 9.76A7.08 7.08 0 0 1 16.42 6.5L19.9 3A11.97 11.97 0 0 0 1.24 6.65l4.03 3.11Z" />
      <path fill="#34A853" d="M16.04 18.01A7.4 7.4 0 0 1 12 19.1a7.08 7.08 0 0 1-6.72-4.82l-4.04 3.06A11.96 11.96 0 0 0 12 24a11.4 11.4 0 0 0 7.83-3l-3.79-2.99Z" />
      <path fill="#4A90E2" d="M19.83 21c2.2-2.05 3.62-5.1 3.62-9 0-.7-.1-1.47-.27-2.18H12v4.63h6.44a5.4 5.4 0 0 1-2.4 3.56l3.8 2.99Z" />
      <path fill="#FBBC05" d="M5.28 14.27a7.12 7.12 0 0 1-.01-4.5L1.24 6.64A11.93 11.93 0 0 0 0 12c0 1.92.44 3.73 1.24 5.33l4.04-3.06Z" />
    </svg>
  );
}
