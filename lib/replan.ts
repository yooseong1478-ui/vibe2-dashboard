// 동적 목표 재계산 엔진 (2026-08-25 지침서 PART 2).
// 매일 실적이 들어오면 남은 날의 목표·예산·목표 CPA 를 전부 다시 계산한다.
// 순수 함수 — 어드민 저장 미리보기·인제스트 스냅샷·대시보드 렌더가 전부 이 모듈을 쓴다.
//
// 원칙:
//  - 재계산 결과는 저장하지 않는다 (확정된 과거는 daily[].planSnapshot 으로만 동결)
//  - 과거 소급 변경 금지 — 오늘 이후만 계산
//  - 가중치·기준CPA 는 data/benchmarks.json 의 vibe2PaceCurve — 코드 하드코딩 금지
//  - 곡선이 없으면 에러 (균등분배 폴백 금지)
//  - 가드레일 위반은 조용히 캡만 하지 말고 반드시 플래그로 노출

import type { Dataset } from "./types";
import { diffDays, addDays, deriveDaily } from "./metrics";
import benchmarks from "@/data/benchmarks.json";

export interface PaceBand {
  minD: number;
  maxD: number;
  phase: string;
  weight: number;
  baseCPA: number;
}

export type ReplanFlag =
  | "SPEND_CAP"        // 일 지출 상한 캡 (초과분 인접일 재배분)
  | "RAMP_CAP"         // 전일 대비 증액 상한 캡 — 학습 리셋 위험
  | "LOW_ALLOWED_CPA"  // 허용 CPA 하한 미달 — 예산 부족, 목표 하향 필요
  | "PHYSICAL_LIMIT"   // 필요 일평균이 물리 한계 초과 — 목표 재협상
  | "BUDGET_EXHAUSTED"; // 잔여 예산 소진 — 집행 중단

export interface ReplanDay {
  date: string;
  daysToLive: number;   // 마감일까지 남은 일수 (당일 포함)
  phase: string;
  targetLeads: number;
  targetCPA: number;
  budget: number;
  flags: ReplanFlag[];
}

export interface ReplanResult {
  days: ReplanDay[];
  remainingLeads: number;
  remainingBudget: number;
  remainingDays: number;
  allowedCPA: number | null;   // 잔여예산 ÷ 잔여목표
  perDayNeeded: number | null;
  achievableLeads: number | null; // 캡 적용 후 총합이 잔여목표에 못 미칠 때 "달성 가능 최대치"
  warnings: ReplanFlag[];      // 전역 경고 (개별일 플래그와 별도)
}

function curveFor(daysToLive: number): PaceBand {
  const bands = (benchmarks as any)?.vibe2PaceCurve?.byDaysToLive as PaceBand[] | undefined;
  if (!bands?.length) {
    // 균등분배 폴백 금지 — 곡선이 없으면 명시적으로 실패시킨다
    throw new Error("benchmarks.json 에 vibe2PaceCurve 가 없습니다 — 재계산 불가");
  }
  const hit = bands.find((b) => daysToLive >= b.minD && daysToLive <= b.maxD);
  if (!hit) throw new Error(`vibe2PaceCurve 에 D-${daysToLive} 구간이 없습니다`);
  return hit;
}

// todayIso 부터 마감일(goals.webinarDate)까지의 목표를 재계산한다.
export function replanFuture(data: Dataset, todayIso: string): ReplanResult {
  const g = data.goals;
  const guard = g.replan ?? { dailySpendCap: 20_000_000, rampCapRatio: 1.5, minAllowedCpa: 8000, maxDailyLeads: 2200 };
  const end = g.webinarDate;

  const derived = deriveDaily(data.daily);
  const withLeads = derived.filter((r) => r.leadsCum !== null);
  const leadsCum = withLeads.length ? (withLeads[withLeads.length - 1].leadsCum as number) : 0;
  const spendSum = derived.reduce((s, r) => s + (r.spend ?? 0), 0);
  // 전일 실측 지출 (증액 속도 가드의 기준)
  const withSpend = derived.filter((r) => r.spend != null && r.date < todayIso);
  const prevSpend = withSpend.length ? (withSpend[withSpend.length - 1].spend as number) : null;

  const remainingLeads = Math.max(0, g.targetLeads - leadsCum);
  const remainingBudget = g.totalBudget - spendSum;
  const remainingDays = Math.max(0, diffDays(todayIso, end) + 1); // 오늘 포함
  const allowedCPA = remainingLeads > 0 ? remainingBudget / remainingLeads : null;
  const perDayNeeded = remainingDays > 0 ? remainingLeads / remainingDays : null;

  const warnings: ReplanFlag[] = [];
  if (remainingBudget <= 0) warnings.push("BUDGET_EXHAUSTED");
  if (allowedCPA !== null && allowedCPA < guard.minAllowedCpa) warnings.push("LOW_ALLOWED_CPA");
  if (perDayNeeded !== null && perDayNeeded > guard.maxDailyLeads) warnings.push("PHYSICAL_LIMIT");

  if (remainingDays === 0 || remainingLeads === 0) {
    return { days: [], remainingLeads, remainingBudget, remainingDays, allowedCPA, perDayNeeded, achievableLeads: null, warnings };
  }

  // [2단계] 가중치 배분
  const dates: { date: string; d: number; band: PaceBand }[] = [];
  for (let cur = todayIso, i = 0; i < remainingDays; cur = addDays(cur, 1), i++) {
    const d = diffDays(cur, end) + 1;
    dates.push({ date: cur, d, band: curveFor(d) });
  }
  const wSum = dates.reduce((s, x) => s + x.band.weight, 0);
  let targets = dates.map((x) => (remainingLeads * x.band.weight) / wSum);

  // [3단계] 기준 CPA 를 잔여예산에 맞게 스케일링
  const baseCost = dates.reduce((s, x, i) => s + targets[i] * x.band.baseCPA, 0);
  const scale = baseCost > 0 ? Math.max(0, remainingBudget) / baseCost : 0;
  let cpas = dates.map((x) => x.band.baseCPA * scale);
  let budgets = targets.map((t, i) => t * cpas[i]);

  // [4단계] 가드레일 — 캡 + 초과분 인접일 재배분 + 플래그
  const flags: ReplanFlag[][] = dates.map(() => []);

  // (a) 일 지출 절대 상한
  for (let pass = 0; pass < 3; pass++) {
    let overflow = 0;
    for (let i = 0; i < budgets.length; i++) {
      if (budgets[i] > guard.dailySpendCap) {
        overflow += budgets[i] - guard.dailySpendCap;
        budgets[i] = guard.dailySpendCap;
        if (!flags[i].includes("SPEND_CAP")) flags[i].push("SPEND_CAP");
      }
    }
    if (overflow <= 0) break;
    // 여유 있는 날에 비례 재배분
    const room = budgets.map((b) => Math.max(0, guard.dailySpendCap - b));
    const roomSum = room.reduce((s, r) => s + r, 0);
    if (roomSum <= 0) break;
    for (let i = 0; i < budgets.length; i++) budgets[i] += (overflow * room[i]) / roomSum;
  }

  // (b) 증액 속도 상한 — 첫 재계산일만 전일 실측 대비 (그 뒤는 계획끼리라 자연 연속)
  if (prevSpend != null && budgets.length > 0) {
    const cap = prevSpend * guard.rampCapRatio;
    if (budgets[0] > cap) {
      budgets[0] = cap;
      flags[0].push("RAMP_CAP");
    }
  }

  // 예산 조정 후 목표·CPA 재정합: CPA 는 구간 기준 비율을 유지한 채 예산에 맞춘다
  const finalDays: ReplanDay[] = dates.map((x, i) => {
    const cpa = cpas[i] > 0 ? cpas[i] : x.band.baseCPA;
    const t = budgets[i] / cpa;
    return {
      date: x.date,
      daysToLive: x.d,
      phase: x.band.phase,
      targetLeads: Math.round(t),
      targetCPA: Math.round(cpa),
      budget: Math.round(budgets[i]),
      flags: flags[i],
    };
  });

  const totalPlanned = finalDays.reduce((s, x) => s + x.targetLeads, 0);
  const achievableLeads = totalPlanned < remainingLeads * 0.995 ? leadsCum + totalPlanned : null;

  return { days: finalDays, remainingLeads, remainingBudget, remainingDays, allowedCPA, perDayNeeded, achievableLeads, warnings };
}

// 특정 날짜 하나의 재계산 목표 (인제스트가 그날 planSnapshot 을 동결할 때 사용)
export function replanForDate(data: Dataset, dateIso: string): { targetLeads: number; targetSpend: number; targetCPA: number } | null {
  try {
    const r = replanFuture(data, dateIso);
    const day = r.days.find((d) => d.date === dateIso);
    if (!day) return null;
    return { targetLeads: day.targetLeads, targetSpend: day.budget, targetCPA: day.targetCPA };
  } catch {
    return null;
  }
}
