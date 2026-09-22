import { NextRequest, NextResponse } from "next/server";
import { resolveAuth } from "@/lib/session";
import {
  getUserBaseMaps,
  setUserSelectedBaseMap,
  addCustomBaseMap,
  deleteCustomBaseMap,
} from "@/lib/settings";

export async function GET(req: NextRequest) {
  try {
    const ctx = await resolveAuth(req);
    const userId = ctx?.user?.id || (ctx?.mode === "apikey" ? "default" : undefined);
    const data = await getUserBaseMaps(userId);
    return NextResponse.json(data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to load base maps";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await resolveAuth(req);
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = ctx.user?.id || (ctx.mode === "apikey" ? "default" : undefined);

    const body = await req.json();
    const { name, url, attribution, maxZoom, subdomains } = body;

    const data = await addCustomBaseMap(
      {
        name,
        url,
        attribution,
        maxZoom: typeof maxZoom === "number" ? maxZoom : Number(maxZoom) || 19,
        subdomains,
      },
      userId
    );

    return NextResponse.json(data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to add base map";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await resolveAuth(req);
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = ctx.user?.id || (ctx.mode === "apikey" ? "default" : undefined);

    const body = await req.json();
    const { selectedId } = body;

    if (!selectedId || typeof selectedId !== "string") {
      return NextResponse.json({ error: "selectedId is required" }, { status: 400 });
    }

    await setUserSelectedBaseMap(userId, selectedId);
    return NextResponse.json({ success: true, selectedId });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to set active base map";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const ctx = await resolveAuth(req);
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = ctx.user?.id || (ctx.mode === "apikey" ? "default" : undefined);

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "id parameter is required" }, { status: 400 });
    }

    const data = await deleteCustomBaseMap(id, userId);
    return NextResponse.json(data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to delete base map";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
