import { NextRequest, NextResponse } from "next/server";
import { getAssetThumbnailStream } from "@/lib/immich";
import { resolveAuth } from "@/lib/session";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await resolveAuth(req);
    if (!ctx) {
      return new NextResponse(null, { status: 401 });
    }

    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const sizeParam = searchParams.get("size");
    const size = sizeParam === "preview" ? "preview" : "thumbnail";

    const streamResult = await getAssetThumbnailStream(ctx.auth, id, size);
    if (!streamResult || !streamResult.body) {
      return new NextResponse(null, { status: 404 });
    }

    return new NextResponse(streamResult.body, {
      status: 200,
      headers: {
        "Content-Type": streamResult.contentType,
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      },
    });
  } catch (err) {
    console.error("Thumbnail proxy error:", err);
    return new NextResponse(null, { status: 500 });
  }
}
