// Live API WebSocket is not supported in Vercel serverless.
// The frontend automatically falls back to turn-based mode.
//
// To enable Live API, deploy server/index.js on a host with
// persistent WebSocket support (Fly.io, Railway, etc.).
//
// For Vercel Pro, see:
// https://vercel.com/docs/websockets

import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(
    { error: "WebSocket not available on Vercel serverless. Use turn-based mode or deploy server/ separately." },
    { status: 400 }
  );
}
