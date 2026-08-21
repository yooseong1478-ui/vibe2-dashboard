// 예상 착지 3시나리오 — "남은 돈으로 몇 명 살 수 있냐"로만 계산한다.
// "계획 대비 %" 선형 외삽 금지: 저지출 구간의 CPA 효율을 스케일업 이후로 늘려 붙이면 안 된다.
// 노마5기 실측: W1 CPA 4,291 → 스케일업기 5,613 (+31%) — 그래서 기준 시나리오에 스케일업 계수 k 를 먹인다.
//
//   낙관 = 누적 + 잔여예산        ÷ 3일 이동 CPA
//   기준 = 누적 + 잔여예산×0.95  ÷ (7일 이동 CPA × k)
//   보수 = 누적 + 잔여예산×0.90  ÷ 잔여 플랜 목표 CPA 예산가중평균
//
// k 룩업 (목표 일예산 ÷ 최근 7일 평균 일지출):
//   ≤1배 1.00 · ~1.5배 1.05 · ~2배 1.15 · ~3배 1.25 · 4배+ 1.30

import type { Dataset } from "./types";
import { diffDays, todayKST, type DailyDerived } from "./metrics";

export interface LandingView {
  optimistic: number | null;
  base: number | null;         // 대표값은 항상 '기준'
  conservative: number | null;
  cpa3: number | null;         // 3일 이동 CPA
  cpa7: number | null;         // 7일 이동 CPA
  planCpaRemaining: number | null; // 잔여 플랜 목표 CPA (예산가중)
  k: number;                   // 스케일업 계수
  scaleRatio: number | null;   // 목표 일예산 ÷ 최근 7일 평균 일지출
  remBudget: number;
  // 착지 밴드 vs 목표 판정: 🟢 보수≥목표 / 🟡 기준≥목표>보수 / 🔴 기준<목표
  signal: "green" | "yellow" | "red" | "gray";
  spendPlanRatio: number | null; // 집행률 = 누적지출 ÷ 계획 누적지출 (±10% 이탈 감시)
}

function rollingCpa(complete: DailyDerived[], days: number): number | null {
  const win = complete.slice(-days);
  const sp = win.reduce((s, d) => s + (d.spend ?? 0), 0);
  const ld = win.reduce((s, d) => s + (d.dailyLeads ?? 0), 0);
  return ld ? sp / ld : null;
}

export function computeLanding(data: Dataset, derived: DailyDerived[], nowMs: number): LandingView {
  const g = data.goals;
  const today = todayKST(nowMs);
  const complete = derived.filter((d) => d.dailyLeads !== null && d.spend !== null);

  const totalSpend = derived.reduce((s, d) => s + (d.spend ?? 0), 0);
  const leadsCum = complete.reduce((s, d) => s + (d.dailyLeads ?? 0), 0);
  const remBudget = Math.max(0, g.totalBudget - totalSpend);

  const cpa3 = rollingCpa(complete, 3);
  const cpa7 = rollingCpa(complete, 7);

  // 최근 7일 평균 일지출 (지출 있는 날 기준)
  const spendDays = derived.filter((d) => (d.spend ?? 0) > 0).slice(-7);
  const avgDailySpend = spendDays.length
    ? spendDays.reduce((s, d) => s + (d.spend ?? 0), 0) / spendDays.length
    : null;

  // 잔여 플랜 (오늘 이후): 평균 일예산 + 목표 CPA 예산가중평균
  let remPlanBudget = 0;
  let remPlanDays = 0;
  let remPlanCpaWeighted = 0;
  for (const p of data.plan) {
    for (let cur = p.from; diffDays(cur, p.to) >= 0; cur = addDay(cur)) {
      if (diffDays(today, cur) <= 0) continue; // 내일부터
      remPlanBudget += p.dailyBudget;
      remPlanDays += 1;
      remPlanCpaWeighted += p.dailyBudget * p.targetCpa;
    }
  }
  const targetDailyBudget = remPlanDays ? remPlanBudget / remPlanDays : null;
  const planCpaRemaining = remPlanBudget ? remPlanCpaWeighted / remPlanBudget : null;

  // 스케일업 계수 k
  const scaleRatio = avgDailySpend && targetDailyBudget ? targetDailyBudget / avgDailySpend : null;
  const lookup: [number, number][] = (g as any).landing?.kLookup ?? [
    [1.0, 1.0], [1.5, 1.05], [2.0, 1.15], [3.0, 1.25], [99, 1.3],
  ];
  let k = 1.0;
  if (scaleRatio != null) {
    for (const [cap, kv] of lookup) {
      k = kv;
      if (scaleRatio <= cap) break;
    }
  }

  const hairBase = (g as any).landing?.baseHaircut ?? 0.95;
  const hairCons = (g as any).landing?.conservativeHaircut ?? 0.9;

  const optimistic = cpa3 ? Math.round(leadsCum + remBudget / cpa3) : null;
  const base = cpa7 ? Math.round(leadsCum + (remBudget * hairBase) / (cpa7 * k)) : null;
  const conservative = planCpaRemaining
    ? Math.round(leadsCum + (remBudget * hairCons) / planCpaRemaining)
    : null;

  // 착지 밴드 vs 목표 판정
  let signal: LandingView["signal"] = "gray";
  if (base != null && conservative != null) {
    if (conservative >= g.targetLeads) signal = "green";
    else if (base >= g.targetLeads) signal = "yellow";
    else signal = "red";
  }

  // 집행률 (누적지출 ÷ 오늘까지 계획 누적지출) — ±10% 이탈 감시용
  let planSpendToDate = 0;
  for (const p of data.plan) {
    for (let cur = p.from; diffDays(cur, p.to) >= 0; cur = addDay(cur)) {
      if (diffDays(cur, today) < 0) break;
      planSpendToDate += p.dailyBudget;
    }
  }
  const spendPlanRatio = planSpendToDate ? totalSpend / planSpendToDate : null;

  return {
    optimistic, base, conservative, cpa3, cpa7, planCpaRemaining,
    k, scaleRatio, remBudget, signal, spendPlanRatio,
  };
}

function addDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) + 86400000);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}
