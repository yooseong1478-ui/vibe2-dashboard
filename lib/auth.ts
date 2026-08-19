// /admin 비밀번호 게이트 + 세션 쿠키. 서버 전용.
import "server-only";
import crypto from "crypto";
import { cookies } from "next/headers";

const COOKIE = "vibe2_admin";
const MAX_AGE = 60 * 60 * 12; // 12시간

function secret(): string {
  return (process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD || "insecure-dev-secret").trim();
}

function sign(payload: string): string {
  const mac = crypto.createHmac("sha256", secret()).update(payload).digest("hex");
  return `${payload}.${mac}`;
}

function verify(token: string | undefined): boolean {
  if (!token) return false;
  const idx = token.lastIndexOf(".");
  if (idx < 0) return false;
  const payload = token.slice(0, idx);
  const expected = sign(payload);
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function checkPassword(input: string): boolean {
  // 양쪽 트림: CLI 등록 시 붙는 개행(\r\n)·모바일 키보드의 꼬리 공백으로 인한 불일치 방지
  const pw = (process.env.ADMIN_PASSWORD || "").trim();
  if (!pw) return false;
  const a = Buffer.from(input.trim());
  const b = Buffer.from(pw);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function createSession(): Promise<void> {
  const payload = `admin.${Math.floor(Date.now() / 1000)}`;
  const jar = await cookies();
  jar.set(COOKIE, sign(payload), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export async function isAuthed(): Promise<boolean> {
  const jar = await cookies();
  return verify(jar.get(COOKIE)?.value);
}
