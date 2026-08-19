import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { getDataset, saveDataset } from "@/lib/dataStore";
import { diffDays, todayKST, dayIndex } from "@/lib/metrics";
import type { DailyRecord } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 지난 날짜 수기 보정: 수동 필드(leads, openTalkCum)만 수정. 메타 지표는 건드리지 않는다.
export async function POST(req: Request) {
  if (!(await isAuthed())) {
    return NextResponse.json({ ok: false, error: "인증이 필요합니다." }, { status: 401 });
  }
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "잘못된 요청" }, { status: 400 });
  }
  const edits: { date: string; leads?: number | null; openTalkCum?: number | null }[] =
    Array.isArray(body?.edits) ? body.edits : [];
  if (!edits.length) {
    return NextResponse.json({ ok: false, error: "수정할 항목이 없습니다." }, { status: 400 });
  }

  const { data, error } = await getDataset();
  if (!data) return NextResponse.json({ ok: false, error: error ?? "데이터 로드 실패" }, { status: 500 });

  const today = todayKST(Date.now());
  const byDate = new Map<string, DailyRecord>(data.daily.map((d) => [d.date, { ...d }]));
  const changed: string[] = [];

  for (const e of edits) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date)) {
      return NextResponse.json({ ok: false, error: `날짜 형식 오류: ${e.date}` }, { status: 400 });
    }
    if (diffDays(today, e.date) > 0) {
      return NextResponse.json({ ok: false, error: `미래 날짜: ${e.date}` }, { status: 400 });
    }
    if (diffDays(data.goals.startDate, e.date) < 0) {
      return NextResponse.json({ ok: false, error: `시작일 이전: ${e.date}` }, { status: 400 });
    }
    const rec = byDate.get(e.date) || {
      date: e.date, leads: null, openTalkCum: null, spend: null, impressions: null,
      clicks: null, ctr: null, cpm: null, frequency: null, openEvents: null,
    };
    if (e.leads !== undefined) {
      if (e.leads !== null && (!Number.isFinite(e.leads) || e.leads < 0)) {
        return NextResponse.json({ ok: false, error: `${e.date} 알림값 오류 (0 이상 숫자 또는 빈값)` }, { status: 400 });
      }
      if (rec.leads !== e.leads) { rec.leads = e.leads; changed.push(`${e.date} 알림→${e.leads ?? "삭제"}`); }
    }
    if (e.openTalkCum !== undefined) {
      if (e.openTalkCum !== null && (!Number.isFinite(e.openTalkCum) || e.openTalkCum < 0)) {
        return NextResponse.json({ ok: false, error: `${e.date} 오픈톡값 오류` }, { status: 400 });
      }
      if (rec.openTalkCum !== e.openTalkCum) { rec.openTalkCum = e.openTalkCum; changed.push(`${e.date} 오픈톡→${e.openTalkCum ?? "삭제"}`); }
    }
    byDate.set(e.date, rec);
  }

  if (!changed.length) {
    return NextResponse.json({ ok: true, committed: false, message: "변경 사항 없음" });
  }

  const next = {
    ...data,
    meta: { ...data.meta, lastUpdated: new Date().toISOString() },
    daily: [...byDate.values()].sort((a, b) => dayIndex(a.date) - dayIndex(b.date)),
  };

  try {
    const res = await saveDataset(next, `data: 수기 보정 — ${changed.join(", ")}`);
    return NextResponse.json({ ok: true, committed: res.committed, wroteLocal: res.wroteLocal, changed });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 502 });
  }
}
