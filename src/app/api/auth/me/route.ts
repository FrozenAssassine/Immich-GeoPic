import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/immich";
import { resolveAuth } from "@/lib/session";

export async function GET(req: NextRequest) {
  try {
    const ctx = await resolveAuth(req);
    if (!ctx) {
      return NextResponse.json({ authenticated: false, mode: "login" });
    }

    if (ctx.mode === "apikey") {
      try {
        const user = await getCurrentUser(ctx.auth);
        return NextResponse.json({
          authenticated: true,
          mode: "apikey",
          user,
        });
      } catch (err) {
        console.error("Failed to fetch user with API key:", err);
        return NextResponse.json({
          authenticated: true,
          mode: "apikey",
          user: {
            id: "apikey-user",
            name: "API Key User",
            email: "immich-user@local",
            profileImagePath: null,
          },
        });
      }
    }

    return NextResponse.json({
      authenticated: true,
      mode: "login",
      user: ctx.user,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Auth check failed";
    console.error("Auth check error:", message);
    return NextResponse.json({ authenticated: false, mode: "login" });
  }
}
