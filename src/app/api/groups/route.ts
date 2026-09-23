import { NextRequest, NextResponse } from "next/server";
import { resolveAuth } from "@/lib/session";
import {
  getUserGroups,
  createGroup,
  updateGroup,
  deleteGroup,
} from "@/lib/groupStorage";

export async function GET(req: NextRequest) {
  try {
    const ctx = await resolveAuth(req);
    const userId = ctx?.user?.id || (ctx?.mode === "apikey" ? "default" : undefined);

    const groups = await getUserGroups(userId);
    return NextResponse.json({ groups });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to load groups";
    console.error("Groups GET error:", msg);
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
    const { name, lat, lng, radius, directFix } = body;

    const group = await createGroup(
      {
        name,
        lat: Number(lat),
        lng: Number(lng),
        radius: Number(radius) || 0,
        directFix: Boolean(directFix),
      },
      userId
    );

    return NextResponse.json({ success: true, group });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to create group";
    console.error("Groups POST error:", msg);
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
    const { id, name, lat, lng, radius, directFix } = body;

    if (!id || typeof id !== "string") {
      return NextResponse.json({ error: "Group ID is required" }, { status: 400 });
    }

    const group = await updateGroup(
      {
        id,
        name: name !== undefined ? String(name) : undefined,
        lat: lat !== undefined ? Number(lat) : undefined,
        lng: lng !== undefined ? Number(lng) : undefined,
        radius: radius !== undefined ? Number(radius) : undefined,
        directFix: directFix !== undefined ? Boolean(directFix) : undefined,
      },
      userId
    );

    return NextResponse.json({ success: true, group });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to update group";
    console.error("Groups PATCH error:", msg);
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
      return NextResponse.json({ error: "Group ID is required" }, { status: 400 });
    }

    const groups = await deleteGroup(id, userId);
    return NextResponse.json({ success: true, groups });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to delete group";
    console.error("Groups DELETE error:", msg);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
