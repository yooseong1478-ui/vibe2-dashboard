import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { getDataset, saveDataset } from "@/lib/dataStore";
import { diffDays } from "@/lib/metrics";
import type { PlanStep } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 플랜(구간별 목표·예산·CPA·신호등 밴드) 수동 편집.
// 홈의 계획선·일예산선·신호등 존·페이스 갭 목표가 전부 이 plan 에서 파생되므로
// 여기만 고치면 차트 4개가 다 따라온다. goals.totalBudget/targetCpa 는 플랜 합으로 재계산.
interface PlanRowIn {
  name: string;
  from: string;
  to: string;
  leads: number;       // 구간 목표 알림 (perDay 로 환산 저장)
  budget: number;      // 구간 예산 원 (dailyBudget 로 환산 저장)
  targetCpa: number;
  green: number;
  yellow: number;
  freeze: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
  const rows: PlanRowIn[] = Array.isArray(body?.plan) ? body.plan : [];
  if (!rows.length) {
    return NextResponse.json({ ok: false, error: "구간이 없습니다." }, { status: 400 });
  }

  // 검증
  for (const [i, r] of rows.entries()) {
    const tag = `${i + 1}번 구간`;
    if (!DATE_RE.test(r.from) || !DATE_RE.test(r.to)) {
      return NextResponse.json({ ok: false, error: `${tag}: 날짜 형식 오류 (YYYY-MM-DD)` }, { status: 400 });
    }
    if (diffDays(r.from, r.to) < 0) {
      return NextResponse.json({ ok: false, error: `${tag}: 종료일이 시작일보다 빠릅니다.` }, { status: 400 });
    }
    for (const [k, label] of [["leads", "목표 알림"], ["budget", "예산"], ["targetCpa", "목표 CPA"], ["green", "그린"], ["yellow", "옐로"], ["freeze", "동결"]] as const) {
      const v = (r as any)[k];
      if (!Number.isFinite(v) || v <= 0) {
        return NextResponse.json({ ok: false, error: `${tag}: ${label} 값 오류 (양수 필요)` }, { status: 400 });
      }
    }
    if (!(r.green < r.yellow && r.yellow < r.freeze)) {
      return NextResponse.json({ ok: false, error: `${tag}: 밴드는 그린 < 옐로 < 동결 순이어야 합니다.` }, { status: 400 });
    }
  }
  // 구간 겹침 금지 (정렬 후 검사 — 공백은 허용)
  const sorted = [...rows].sort((a, b) => diffDays(b.from, a.from));
  for (let i = 1; i < sorted.length; i++) {
    if (diffDays(sorted[i - 1].to, sorted[i].from) <= 0) {
      return NextResponse.json(
        { ok: false, error: `구간 겹침: ${sorted[i - 1].name || sorted[i - 1].to} ↔ ${sorted[i].name || sorted[i].from}` },
        { status: 400 }
      );
    }
  }

  const { data, error } = await getDataset();
  if (!data) return NextResponse.json({ ok: false, error: error ?? "데이터 로드 실패" }, { status: 500 });

  const plan: PlanStep[] = sorted.map((r) => {
    const days = diffDays(r.from, r.to) + 1;
    return {
      from: r.from,
      to: r.to,
      days,
      perDay: Math.round(r.leads / days),
      dailyBudget: Math.round(r.budget / days),
      targetCpa: Math.round(r.targetCpa),
      name: r.name || undefined,
      bands: { green: Math.round(r.green), yellow: Math.round(r.yellow), freeze: Math.round(r.freeze) },
    };
  });

  const totLeads = plan.reduce((s, p) => s + p.perDay * p.days, 0);
  const totBudget = plan.reduce((s, p) => s + p.dailyBudget * p.days, 0);
  const targetLeads = Number.isFinite(body?.targetLeads) && body.targetLeads > 0
    ? Math.round(body.targetLeads)
    : data.goals.targetLeads;

  const next = {
    ...data,
    goals: {
      ...data.goals,
      targetLeads,
      stretchLeads: targetLeads,
      totalBudget: totBudget,
      targetCpa: totLeads ? Math.round(totBudget / totLeads) : data.goals.targetCpa,
    },
    plan,
    meta: { ...data.meta, lastUpdated: new Date().toISOString() },
  };

  try {
    const res = await saveDataset(next, `plan: 수동 편집 — ${plan.length}구간 · 합계 ${totLeads.toLocaleString()}명 / ${Math.round(totBudget / 10000).toLocaleString()}만원`);
    return NextResponse.json({
      ok: true,
      committed: res.committed,
      wroteLocal: res.wroteLocal,
      summary: { steps: plan.length, totLeads, totBudget, targetLeads },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 502 });
  }
}
