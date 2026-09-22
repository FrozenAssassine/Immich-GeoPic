import { NextRequest, NextResponse } from "next/server";
import { updateAssetLocation } from "@/lib/immich";
import { resolveAuth } from "@/lib/session";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await resolveAuth(req);
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await req.json();
    const { coords } = body;

    if (coords !== null && coords !== undefined) {
      if (
        typeof coords.lat !== "number" ||
        typeof coords.lng !== "number" ||
        Number.isNaN(coords.lat) ||
        Number.isNaN(coords.lng)
      ) {
        return NextResponse.json({ error: "Invalid coordinates" }, { status: 400 });
      }
    }

    await updateAssetLocation(ctx.auth, id, coords ?? null);
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update location";
    console.error("Location update error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
