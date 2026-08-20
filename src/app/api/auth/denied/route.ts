import { NextResponse } from "next/server";

export function GET(request: Request) {
  const reason = new URL(request.url).searchParams.get("reason");
  const message = reason === "closed"
    ? "New OrbitTrack registrations are currently closed. Existing users can still sign in."
    : "OrbitTrack has reached its current account limit. Existing users can still sign in.";
  return new NextResponse(`<!doctype html><title>OrbitTrack registration unavailable</title><main><h1>Registration unavailable</h1><p>${message}</p><p><a href="/api/auth/signin">Return to sign in</a></p></main>`, {
    status: 403,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
