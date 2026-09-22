import { NextRequest, NextResponse } from "next/server";
import { ImmichAuth, ImmichUser } from "./immich";
import crypto from "crypto";

export const SESSION_COOKIE_NAME = "geopic_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export type ServerSession = {
  id: string;
  immichToken: string;
  user: ImmichUser;
  createdAt: number;
  expiresAt: number;
};

// Global session store to persist across Next.js re-evaluations
const globalSessions = globalThis as unknown as {
  _geopic_sessions?: Map<string, ServerSession>;
};

if (!globalSessions._geopic_sessions) {
  globalSessions._geopic_sessions = new Map<string, ServerSession>();
}

const sessionStore = globalSessions._geopic_sessions;

export function isApiKeyMode(): boolean {
  return !!process.env.IMMICH_API_KEY && process.env.IMMICH_API_KEY.trim().length > 0;
}

export function createSession(immichToken: string, user: ImmichUser): string {
  const sessionId = crypto.randomUUID();
  const now = Date.now();

  sessionStore.set(sessionId, {
    id: sessionId,
    immichToken,
    user,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  });

  return sessionId;
}

export function getSession(sessionId: string): ServerSession | null {
  const session = sessionStore.get(sessionId);
  if (!session) return null;

  if (Date.now() > session.expiresAt) {
    sessionStore.delete(sessionId);
    return null;
  }

  return session;
}

export function deleteSession(sessionId: string): string | null {
  const session = sessionStore.get(sessionId);
  if (session) {
    sessionStore.delete(sessionId);
    return session.immichToken;
  }
  return null;
}

export type AuthContext = {
  auth: ImmichAuth;
  user?: ImmichUser;
  mode: "apikey" | "login";
  sessionId?: string;
};

export async function resolveAuth(req: NextRequest): Promise<AuthContext | null> {
  // Mode 1: Zero-Auth Direct API Key Mode
  if (isApiKeyMode()) {
    return {
      auth: { apiKey: process.env.IMMICH_API_KEY!.trim() },
      mode: "apikey",
    };
  }

  // Mode 2: User Login Mode via Session Cookie
  const cookie = req.cookies.get(SESSION_COOKIE_NAME);
  if (!cookie?.value) {
    return null;
  }

  const session = getSession(cookie.value);
  if (!session) {
    return null;
  }

  return {
    auth: { token: session.immichToken },
    user: session.user,
    mode: "login",
    sessionId: session.id,
  };
}

export function attachSessionCookie(res: NextResponse, sessionId: string): void {
  res.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: sessionId,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
