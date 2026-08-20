import { NextResponse } from "next/server";
import { isDatabaseReady } from "@/lib/db";

/** Public, data-free Railway readiness probe. */
export async function GET() {
  if (isDatabaseReady()) {
    return NextResponse.json({ status: "ready" }, { status: 200 });
  }
  return NextResponse.json({ status: "unavailable" }, { status: 503 });
}
