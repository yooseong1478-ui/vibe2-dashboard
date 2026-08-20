// 파생 지표 계산 — 모든 CPA·달성률·예상착지·기대수익·신호등은 여기서만 계산한다.
// JSON 에는 원본만 저장한다는 원칙에 따라, 화면은 이 모듈의 결과만 사용한다.

import type { Dataset, DailyRecord, PlanStep, PlanDay, AdsetRecord } from "./types";

// ── 날짜 유틸 (UTC 기준 day index 로 타임존 흔들림 제거) ─────────────
export function dayIndex(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}
export function diffDays(fromIso: string, toIso: string): number {
  return dayIndex(toIso) - dayIndex(fromIso);
}
export function addDays(iso: string, n: number): string {
  const t = (dayIndex(iso) + n) * 86400000;
  const dt = new Date(t);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
export function todayKST(nowMs: number): string {
  const dt = new Date(nowMs + 9 * 3600 * 1000);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function safeDiv(a: number | null, b: number | null): number | null {
  if (a === null || b === null || !b) return null;
  return a / b;
}

// ── 확정 곡선(계획) 누적 커브 ─────────────────────────────────────
// planBase(램프 끝점) + plan steps 를 날짜별로 펼쳐 누적 목표(알림/지출)를 만든다.
export interface PlanPoint {
  date: string;
  cumLeads: number;
  cumSpend: number;
  perDay: number;
  dailyBudget: number;
  targetCpa: number;
}

// 특정 날짜의 일별 플랜: planDaily 우선, 없으면 (구) 스텝 플랜
export function planForDate(data: Dataset, iso: string): { perDay: number; dailyBudget: number; targetCpa: number } | null {
  const pd = data.planDaily?.find((p) => p.date === iso);
  if (pd) return { perDay: pd.planLeads, dailyBudget: pd.planSpend, targetCpa: pd.planCpa };
  const step = data.plan.find((s) => diffDays(s.from, iso) >= 0 && diffDays(iso, s.to) >= 0);
  if (step) return { perDay: step.perDay, dailyBudget: step.dailyBudget, targetCpa: step.targetCpa };
  return null;
}

// 플랜 누적 곡선. 원칙: 실측이 있는 마지막 날까지는 기존(과거) 플랜 곡선을 유지하고,
// 그 다음 날부터는 [실측 누적 + 일별 플랜 합산] 으로 미래 목표선을 만든다 (플랜 누적은 저장하지 않는다).
export function buildPlanCurve(data: Dataset, derived?: DailyDerived[]): PlanPoint[] {
  const { goals, planBase, plan } = data;
  const start = goals.startDate;
  const lastPlanDaily = data.planDaily?.length ? data.planDaily[data.planDaily.length - 1].date : null;
  const lastStep = plan.length ? plan[plan.length - 1].to : goals.webinarDate;
  const end = lastPlanDaily && diffDays(lastStep, lastPlanDaily) > 0 ? lastPlanDaily : lastStep;

  // 실측 앵커 (전일까지 실측 누적)
  const withLeads = (derived ?? []).filter((d) => d.leadsCum !== null);
  const anchorLeadsDate = withLeads.length ? withLeads[withLeads.length - 1].date : null;
  const anchorLeads = withLeads.length ? withLeads[withLeads.length - 1].leadsCum! : 0;
  const withSpend = (derived ?? []).filter((d) => d.spend !== null);
  const anchorSpendDate = withSpend.length ? withSpend[withSpend.length - 1].date : null;
  let anchorSpend = 0;
  if (anchorSpendDate) for (const d of withSpend) anchorSpend += d.spend ?? 0;

  // 램프 구간: startDate ~ planBase.asOf, planBase 값에 선형 도달
  const rampDays = diffDays(start, planBase.asOf) + 1;
  const rampPerLeads = rampDays > 0 ? planBase.leads / rampDays : 0;
  const rampPerSpend = rampDays > 0 ? planBase.spend / rampDays : 0;

  const points: PlanPoint[] = [];
  let oldCumLeads = 0;
  let oldCumSpend = 0;
  let futCumLeads = anchorLeads;
  let futCumSpend = anchorSpend;
  for (let cur = start; diffDays(cur, end) >= 0; cur = addDays(cur, 1)) {
    let perDay = 0;
    let dailyBudget = 0;
    let targetCpa = 0;
    const pf = planForDate(data, cur);
    if (diffDays(cur, planBase.asOf) >= 0) {
      perDay = rampPerLeads;
      dailyBudget = rampPerSpend;
      targetCpa = rampPerLeads ? rampPerSpend / rampPerLeads : 0;
    } else if (pf) {
      perDay = pf.perDay;
      dailyBudget = pf.dailyBudget;
      targetCpa = pf.targetCpa;
    }
    oldCumLeads += perDay;
    oldCumSpend += dailyBudget;

    // 미래(실측 앵커 이후) 구간은 실측 누적에서 이어붙인다
    const afterLeadsAnchor = anchorLeadsDate !== null && diffDays(anchorLeadsDate, cur) > 0;
    const afterSpendAnchor = anchorSpendDate !== null && diffDays(anchorSpendDate, cur) > 0;
    if (afterLeadsAnchor) futCumLeads += perDay;
    if (afterSpendAnchor) futCumSpend += dailyBudget;

    points.push({
      date: cur,
      cumLeads: Math.round(afterLeadsAnchor ? futCumLeads : oldCumLeads),
      cumSpend: Math.round(afterSpendAnchor ? futCumSpend : oldCumSpend),
      perDay: Math.round(perDay),
      dailyBudget: Math.round(dailyBudget),
      targetCpa: Math.round(targetCpa),
    });
  }
  return points;
}

function planPointAt(curve: PlanPoint[], iso: string): PlanPoint | null {
  // 정확히 일치하는 날짜, 없으면 그 이전 마지막 지점(클램프)
  let best: PlanPoint | null = null;
  for (const p of curve) {
    if (diffDays(p.date, iso) >= 0) best = p;
    else break;
  }
  return best;
}


// ── 일별 파생 (원본 = 일별 leads, 누적은 여기서 합산) ─────────────
export interface DailyDerived extends DailyRecord {
  leadsCum: number | null;     // 파생 누적 (일별 합산)
  dailyLeads: number | null;   // = leads (호환용 별칭)
  cpaAdmin: number | null;     // 일 CPA = spend / leads
  cpaOpenEvent: number | null; // 일 CPA(픽셀) = spend / openEvents
}

export function deriveDaily(daily: DailyRecord[]): DailyDerived[] {
  const sorted = [...daily].sort((a, b) => dayIndex(a.date) - dayIndex(b.date));
  let cum = 0;
  return sorted.map((r) => {
    let leadsCum: number | null = null;
    if (r.leads !== null) {
      cum += r.leads;
      leadsCum = cum;
    }
    return {
      ...r,
      leadsCum,
      dailyLeads: r.leads,
      cpaAdmin: safeDiv(r.spend, r.leads),
      cpaOpenEvent: safeDiv(r.spend, r.openEvents),
    };
  });
}

// ── 신호등 ────────────────────────────────────────────────────────
// 밴드는 구간별(plan step)로 다르다 — 최종 전략서(2026-08-20):
//   P1 🟢≤6,500/🟡≤9,000/🟠≤11,000 · P2 8,500/12,000/14,000 · P3·D 9,000/13,000/18,000
export type SignalLevel = "green" | "yellow" | "freeze" | "red" | "gray";

export interface SignalBands { green: number; yellow: number; freeze: number }

// 해당 날짜가 속한 플랜 구간의 밴드. 구간 밖은 가장 가까운 구간, 그마저 없으면 goals 폴백.
export function bandsForDate(data: Dataset, iso: string): SignalBands {
  const { plan, goals } = data;
  const fallback: SignalBands = {
    green: goals.signalGreenMax,
    yellow: goals.signalYellowMax ?? goals.cpaHardCap,
    freeze: goals.signalFreezeMax ?? goals.cpaHardCap,
  };
  if (!plan.length) return fallback;
  const hit = plan.find((p) => p.bands && diffDays(p.from, iso) >= 0 && diffDays(iso, p.to) >= 0);
  if (hit?.bands) return hit.bands;
  // 플랜 시작 전 → 첫 구간, 종료 후 → 마지막 구간의 밴드
  const first = plan.find((p) => p.bands);
  const last = [...plan].reverse().find((p) => p.bands);
  if (diffDays(iso, plan[0].from) > 0 && first?.bands) return first.bands;
  if (last?.bands) return last.bands;
  return fallback;
}

// 해당 날짜의 하드캡(🟠 동결 상한 = 초과 시 롤백)
export function capForDate(data: Dataset, iso: string): number {
  return bandsForDate(data, iso).freeze;
}
export interface Signal {
  level: SignalLevel;
  rolling3Cpa: number | null;
  label: string;
  reason: string;
  stale: boolean;
}

export function computeSignal(
  derived: DailyDerived[],
  data: Dataset,
  lastUpdatedMs: number,
  nowMs: number
): Signal {
  // 완결일(어드민 알림+지출 모두 존재)만 대상으로 3일 이동 CPA
  const complete = derived.filter((d) => d.dailyLeads !== null && d.spend !== null);
  const last3 = complete.slice(-3);
  const spendSum = last3.reduce((s, d) => s + (d.spend ?? 0), 0);
  const leadsSum = last3.reduce((s, d) => s + (d.dailyLeads ?? 0), 0);
  const rolling3Cpa = leadsSum ? spendSum / leadsSum : null;

  const stale = nowMs - lastUpdatedMs > 24 * 3600 * 1000;
  // 판정 밴드 = 최신 완결일이 속한 구간의 밴드
  const judgeDate = complete.length ? complete[complete.length - 1].date : todayKST(nowMs);
  const b = bandsForDate(data, judgeDate);

  // 2일 연속 일 CPA 가 그 날짜 밴드의 동결 상한 초과 → 레드
  const last2 = complete.slice(-2);
  const twoOverCap =
    last2.length === 2 && last2.every((d) => d.cpaAdmin !== null && d.cpaAdmin > capForDate(data, d.date));

  let level: SignalLevel;
  let label: string;
  let reason: string;
  const cpaStr = rolling3Cpa === null ? "" : `₩${Math.round(rolling3Cpa).toLocaleString()}`;

  if (rolling3Cpa === null) {
    level = "gray";
    label = "데이터 부족";
    reason = "3일 이동 CPA를 계산할 완결 데이터가 부족합니다.";
  } else if (rolling3Cpa > b.freeze || twoOverCap) {
    level = "red";
    label = "롤백";
    reason = twoOverCap
      ? "일 CPA가 2일 연속 동결 상한을 초과했습니다."
      : `3일 이동 CPA ${cpaStr} > ₩${b.freeze.toLocaleString()}.`;
  } else if (rolling3Cpa > b.yellow) {
    level = "freeze";
    label = "동결 · 소재 교체";
    reason = `3일 이동 CPA ${cpaStr} — ₩${b.yellow.toLocaleString()}~₩${b.freeze.toLocaleString()} 동결 구간.`;
  } else if (rolling3Cpa > b.green) {
    level = "yellow";
    label = "유지";
    reason = `3일 이동 CPA ${cpaStr} — 그린(₩${b.green.toLocaleString()})~₩${b.yellow.toLocaleString()} 구간.`;
  } else {
    level = "green";
    label = "가속";
    reason = `3일 이동 CPA ${cpaStr} ≤ ₩${b.green.toLocaleString()}.`;
  }

  // 갱신 지연 시 등급은 유지하되 gray 뱃지로 덮어쓴다(판정은 reason 에 남김)
  if (stale) {
    return { level: "gray", rolling3Cpa, label: "갱신 필요", reason: `${label} · 24시간 이상 미갱신`, stale };
  }
  return { level, rolling3Cpa, label, reason, stale };
}

// ── 신호등 히스토리 (일자별 3일 이동 CPA 판정) ────────────────────
export interface SignalDay { date: string; level: SignalLevel; cpa: number | null }

export function computeSignalHistory(derived: DailyDerived[], data: Dataset, days = 7): SignalDay[] {
  const complete = derived.filter((d) => d.dailyLeads !== null && d.spend !== null);
  const out: SignalDay[] = [];
  for (let i = 0; i < complete.length; i++) {
    const win = complete.slice(Math.max(0, i - 2), i + 1);
    const spend = win.reduce((s, d) => s + (d.spend ?? 0), 0);
    const leads = win.reduce((s, d) => s + (d.dailyLeads ?? 0), 0);
    const cpa = leads ? spend / leads : null;
    let level: SignalLevel = "gray";
    if (cpa !== null) {
      const b = bandsForDate(data, complete[i].date);
      const last2 = complete.slice(Math.max(0, i - 1), i + 1);
      const twoOver = last2.length === 2 && last2.every((d) => d.cpaAdmin !== null && d.cpaAdmin > capForDate(data, d.date));
      level = cpa > b.freeze || twoOver ? "red" : cpa > b.yellow ? "freeze" : cpa > b.green ? "yellow" : "green";
    }
    out.push({ date: complete[i].date, level, cpa });
  }
  return out.slice(-days);
}

// ── 전체 뷰모델 ──────────────────────────────────────────────────
export interface RevenueBand { leadsLow: number; leadsHigh: number; revLow: number; revHigh: number }

function band(leads: number, goals: Dataset["goals"]): RevenueBand {
  return {
    leadsLow: leads * goals.conversionBand.low,
    leadsHigh: leads * goals.conversionBand.high,
    revLow: leads * goals.conversionBand.low * goals.aov,
    revHigh: leads * goals.conversionBand.high * goals.aov,
  };
}

export interface DashboardView {
  asOfDate: string | null;          // 어드민 알림이 존재하는 최신일
  latestDataDate: string | null;    // 지표가 존재하는 최신일(지출 등)
  derived: DailyDerived[];
  signal: Signal;

  // 누적 3카드
  leadsCum: number | null;
  spendCum: number | null;          // asOf 기준 누적 지출
  cpaAdmin: number | null;
  planLeadsToDate: number | null;   // 당일 누적 목표 알림
  planSpendToDate: number | null;   // 당일 누적 목표 지출
  planCpaToDate: number | null;     // 당일 목표 CPA
  leadsAchieveRate: number | null;
  spendAchieveRate: number | null;

  // KPI 6카드
  goalProgress: number | null;      // leadsCum / targetLeads
  todayRequired: number | null;     // 오늘(KST) 필요 인원
  latestActualDaily: number | null; // 최신 완결일 일 알림
  remainingLeads: number | null;
  remainingDays: number | null;
  perDayNeeded: number | null;      // 잔여 필요 인원/일
  remainingBudget: number | null;
  rolling3Cpa: number | null;
  rolling3AvgLeads: number | null;
  projectedLanding: number | null;  // 예상 착지

  // CPA 이중 표기
  cpaOpenEvent: number | null;
  openEventsCum: number | null;
  cpaGapPct: number | null;         // (admin - oe)/oe * 100
  cpaGapWarn: boolean;

  // 기대수익 3단
  bandCurrent: RevenueBand | null;
  bandLanding: RevenueBand | null;
  bandTarget: RevenueBand;
  capToday: number;
  cpaHeadroom: number | null;

  // 확정 곡선
  planCurve: PlanPoint[];

  // 세트별(최신일)
  latestAdsets: (AdsetRecord & { cpa: number | null; cpc: number | null; cpmCalc: number | null })[];
  latestAdsetDate: string | null;
}

export function computeView(data: Dataset, nowMs: number): DashboardView {
  const goals = data.goals;
  const derived = deriveDaily(data.daily);
  const planCurve = buildPlanCurve(data, derived);

  const withLeads = derived.filter((d) => d.leadsCum !== null);
  const asOf = withLeads.length ? withLeads[withLeads.length - 1] : null;
  const asOfDate = asOf ? asOf.date : null;

  const withSpend = derived.filter((d) => d.spend !== null);
  const latestDataDate = withSpend.length ? withSpend[withSpend.length - 1].date : null;

  const lastUpdatedMs = Date.parse(data.meta.lastUpdated);
  const signal = computeSignal(derived, data, lastUpdatedMs, nowMs);

  // asOf 기준 누적(알림 존재 최신일까지)
  const upToAsOf = asOfDate ? derived.filter((d) => diffDays(d.date, asOfDate) >= 0) : [];
  const spendCum = asOfDate ? upToAsOf.reduce((s, d) => s + (d.spend ?? 0), 0) : null;
  const openEventsCum = asOfDate ? upToAsOf.reduce((s, d) => s + (d.openEvents ?? 0), 0) : null;
  const leadsCum = asOf ? asOf.leadsCum : null;
  const cpaAdmin = safeDiv(spendCum, leadsCum);
  const cpaOpenEvent = safeDiv(spendCum, openEventsCum);

  const planAt = asOfDate ? planPointAt(planCurve, asOfDate) : null;
  const planLeadsToDate = planAt ? planAt.cumLeads : null;
  const planSpendToDate = planAt ? planAt.cumSpend : null;
  const planCpaToDate = planAt && planAt.cumLeads ? planAt.cumSpend / planAt.cumLeads : null;

  const leadsAchieveRate = leadsCum !== null && planLeadsToDate ? (leadsCum / planLeadsToDate) * 100 : null;
  const spendAchieveRate = spendCum !== null && planSpendToDate ? (spendCum / planSpendToDate) * 100 : null;

  // 신호등 3일 이동
  const complete = derived.filter((d) => d.dailyLeads !== null && d.spend !== null);
  const last3 = complete.slice(-3);
  const rolling3Spend = last3.reduce((s, d) => s + (d.spend ?? 0), 0);
  const rolling3Leads = last3.reduce((s, d) => s + (d.dailyLeads ?? 0), 0);
  const rolling3Cpa = rolling3Leads ? rolling3Spend / rolling3Leads : null;
  const rolling3AvgLeads = last3.length ? rolling3Leads / last3.length : null;

  // KPI
  const goalProgress = leadsCum !== null ? (leadsCum / goals.targetLeads) * 100 : null;
  const today = todayKST(nowMs);
  const todayPlan = planForDate(data, today);
  const todayRequired = todayPlan ? todayPlan.perDay : null; // 당일 planLeads
  const capToday = capForDate(data, today);
  const latestActualDaily = complete.length ? complete[complete.length - 1].dailyLeads : null;
  const remainingLeads = leadsCum !== null ? Math.max(0, goals.targetLeads - leadsCum) : null;
  const remainingDays = asOfDate ? Math.max(0, diffDays(asOfDate, goals.webinarDate)) : null;
  const perDayNeeded =
    remainingLeads !== null && remainingDays ? remainingLeads / remainingDays : null;
  const remainingBudget = spendCum !== null ? goals.totalBudget - spendCum : null;
  const projectedLanding =
    remainingBudget !== null && rolling3Cpa && leadsCum !== null
      ? Math.round(remainingBudget / rolling3Cpa + leadsCum)
      : null;

  // CPA 괴리
  const cpaGapPct =
    cpaAdmin !== null && cpaOpenEvent ? ((cpaAdmin - cpaOpenEvent) / cpaOpenEvent) * 100 : null;
  const cpaGapWarn = cpaGapPct !== null && Math.abs(cpaGapPct) >= 20;

  // 기대수익 (3번째 카드는 스트레치 10,000 기준 유지)
  const bandCurrent = leadsCum !== null ? band(leadsCum, goals) : null;
  const bandLanding = projectedLanding !== null ? band(projectedLanding, goals) : null;
  const bandTarget = band(goals.stretchLeads ?? goals.targetLeads, goals);
  const cpaHeadroom = cpaAdmin !== null ? capToday - cpaAdmin : null; // 하드캡 대비 여유

  // 세트별 최신일
  const adsetDates = [...new Set(data.adsets.map((a) => a.date))].sort(
    (a, b) => dayIndex(a) - dayIndex(b)
  );
  const latestAdsetDate = adsetDates.length ? adsetDates[adsetDates.length - 1] : null;
  const latestAdsets = (latestAdsetDate ? data.adsets.filter((a) => a.date === latestAdsetDate) : [])
    .map((a) => ({
      ...a,
      cpa: safeDiv(a.spend, a.openEvents),
      cpc: safeDiv(a.spend, a.clicks),
      cpmCalc: a.impressions ? (a.spend / a.impressions) * 1000 : null,
    }))
    .sort((a, b) => (a.cpa ?? Infinity) - (b.cpa ?? Infinity));

  return {
    asOfDate,
    latestDataDate,
    derived,
    signal,
    leadsCum,
    spendCum,
    cpaAdmin,
    planLeadsToDate,
    planSpendToDate,
    planCpaToDate,
    leadsAchieveRate,
    spendAchieveRate,
    goalProgress,
    todayRequired,
    latestActualDaily,
    remainingLeads,
    remainingDays,
    perDayNeeded,
    remainingBudget,
    rolling3Cpa,
    rolling3AvgLeads,
    projectedLanding,
    capToday,
    cpaHeadroom,
    cpaOpenEvent,
    openEventsCum,
    cpaGapPct,
    cpaGapWarn,
    bandCurrent,
    bandLanding,
    bandTarget,
    planCurve,
    latestAdsets,
    latestAdsetDate,
  };
}
