import { NextResponse } from "next/server";
import { buildAuthorizationUrl } from "@/lib/ml/auth";

/**
 * POST /api/auth/login
 * Returns the MercadoLibre authorization URL the user should open in a browser.
 * The body is just for parity; nothing required.
 */
export async function POST(): Promise<NextResponse> {
  const url = buildAuthorizationUrl();
  return NextResponse.json({ authorization_url: url });
}

export async function GET(): Promise<NextResponse> {
  const url = buildAuthorizationUrl();
  return NextResponse.json({ authorization_url: url });
}