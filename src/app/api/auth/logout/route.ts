import { NextRequest, NextResponse } from "next/server";
import { logoutFromImmich } from "@/lib/immich";
import { clearSessionCookie, deleteSession, SESSION_COOKIE_NAME } from "@/lib/session";

export async function POST(req: NextRequest) {
  const sessionId = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (sessionId) {
    const immichToken = deleteSession(sessionId);
    if (immichToken) {
      await logoutFromImmich(immichToken);
    }
  }

  const res = NextResponse.json({ success: true });
  clearSessionCookie(res);
  return res;
}
