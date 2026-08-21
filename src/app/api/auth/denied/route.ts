import { NextResponse } from "next/server";

export function GET(request: Request) {
  const reason = new URL(request.url).searchParams.get("reason");
  const error = reason === "closed" ? "RegistrationClosed" : "RegistrationFull";
  return NextResponse.redirect(new URL(`/signin?error=${error}`, request.url));
}
