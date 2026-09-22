import { NextRequest, NextResponse } from "next/server";
import { loginToImmich } from "@/lib/immich";
import { attachSessionCookie, createSession, isApiKeyMode } from "@/lib/session";

export async function POST(req: NextRequest) {
  try {
    if (isApiKeyMode()) {
      return NextResponse.json({
        success: true,
        message: "Instance is operating in API key mode; login is not required.",
      });
    }

    const body = await req.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    const { accessToken, user } = await loginToImmich(email, password);
    const sessionId = createSession(accessToken, user);

    const res = NextResponse.json({
      success: true,
      user,
    });

    attachSessionCookie(res, sessionId);
    return res;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Authentication failed";
    console.error("Login error:", message);
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
