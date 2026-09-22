import { NextRequest, NextResponse } from "next/server";
import { getProfileImageStream } from "@/lib/immich";
import { resolveAuth } from "@/lib/session";

export async function GET(req: NextRequest) {
  try {
    const ctx = await resolveAuth(req);
    if (!ctx) {
      return new NextResponse(null, { status: 401 });
    }

    const streamResult = await getProfileImageStream(ctx.auth);
    if (!streamResult || !streamResult.body) {
      return new NextResponse(null, { status: 404 });
    }

    return new NextResponse(streamResult.body, {
      status: 200,
      headers: {
        "Content-Type": streamResult.contentType,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    console.error("Profile image proxy error:", err);
    return new NextResponse(null, { status: 500 });
  }
}
