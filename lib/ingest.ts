// 저장 파이프라인: 검증 → 메타 수집 → 병합 → 저장.
import { replanForDate } from "./replan";
import "server-only";
import type { Dataset, DailyRecord } from "./types";
import { dayIndex, todayKST, diffDays, deriveDaily } from "./metrics";
import { fetchMetaRange, fetchCreativePerformance } from "./meta";
import { saveDataset } from "./dataStore";

export interface IngestInput {
  date: string;          // YYYY-MM-DD
  leads: number;         // 어드민 알림 일별(필수)
  openTalkCum?: number | null; // 오픈톡방 누적(선택)
  confirmSurge?: boolean; // +1,500 급증 확인 통과
  refreshAll?: boolean;   // 시작일부터 전 기간 메타 재수집 (매핑 보정 등 복구용)
}

export interface IngestValidation {
  ok: boolean;
  needConfirm?: boolean;
  error?: string;
  warnings: string[];
}

const SURGE = 1500;

// 커밋 전 검증. 메타 수집 이전에 어드민 입력값을 검증한다.
export function validateInput(data: Dataset, input: IngestInput, nowMs: number): IngestValidation {
  const warnings: string[] = [];
  const today = todayKST(nowMs);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    return { ok: false, error: "날짜 형식이 올바르지 않습니다 (YYYY-MM-DD).", warnings };
  }
  if (diffDays(today, input.date) > 0) {
    return { ok: false, error: "미래 날짜는 입력할 수 없습니다.", warnings };
  }
  if (!Number.isFinite(input.leads) || input.leads < 0) {
    return { ok: false, error: "알림신청 일별 값이 올바르지 않습니다 (0 이상 숫자).", warnings };
  }
  if (diffDays(data.goals.startDate, input.date) < 0) {
    return { ok: false, error: `시작일(${data.goals.startDate}) 이전 날짜입니다.`, warnings };
  }

  if (input.leads > SURGE && !input.confirmSurge) {
    return {
      ok: false,
      needConfirm: true,
      error: `일 +${input.leads.toLocaleString()}명은 급증 기준(${SURGE.toLocaleString()})을 넘습니다. 확인 후 다시 저장하세요.`,
      warnings,
    };
  }

  // 이미 값이 있는 날짜를 덮어쓰는 경우 경고만 (수기 보정 허용)
  const existing = data.daily.find((d) => d.date === input.date);
  if (existing && existing.leads !== null && existing.leads !== input.leads) {
    warnings.push(`${input.date} 기존 값 ${existing.leads.toLocaleString()}명을 ${input.leads.toLocaleString()}명으로 덮어씁니다.`);
  }

  if (input.openTalkCum != null) {
    const priorOt = [...data.daily]
      .filter((d) => d.openTalkCum != null && diffDays(d.date, input.date) > 0)
      .sort((a, b) => dayIndex(a.date) - dayIndex(b.date))
      .pop();
    if (priorOt && input.openTalkCum < priorOt.openTalkCum!) {
      warnings.push(`오픈톡방 누적이 전일(${priorOt.openTalkCum})보다 감소했습니다.`);
    }
  }

  return { ok: true, warnings };
}

// 입력일 기준으로 메타 백필 범위 계산: 빠진 날짜(지출 없음) + 입력일까지.
function backfillRange(data: Dataset, input: IngestInput): { since: string; until: string } {
  const until = input.date;
  if (input.refreshAll) return { since: data.goals.startDate, until };
  // 지출이 채워진 마지막 날짜 이후부터 백필. 없으면 시작일부터.
  const withSpend = data.daily
    .filter((d) => d.spend !== null)
    .sort((a, b) => dayIndex(a.date) - dayIndex(b.date));
  let since = data.goals.startDate;
  if (withSpend.length) {
    const last = withSpend[withSpend.length - 1].date;
    // 마지막 채워진 날부터 다시(경계일 갱신) — 단, 입력일보다 앞서야 함
    since = diffDays(last, until) > 0 ? last : until;
  }
  return { since, until };
}

export interface IngestResult {
  saved: boolean;
  committed: boolean;
  wroteLocal: boolean;
  spendChangeWarning?: string;
  creativeRefreshError?: string;
  discoveredActionTypes: string[];
  openEventActionType: string | null;
  updatedDates: string[];
  dataset: Dataset; // 저장에 사용한 최신 데이터셋(프로덕션에선 재읽기가 옛값이므로 이걸로 요약 계산)
}

// 검증 통과 후: 메타 수집 → 병합 → 저장.
export async function runIngest(data: Dataset, input: IngestInput, nowMs: number): Promise<IngestResult> {
  const { since, until } = backfillRange(data, input);
  const meta = await fetchMetaRange(since, until);

  const byDate = new Map<string, DailyRecord>();
  for (const d of data.daily) byDate.set(d.date, { ...d });

  // 메타 일별 병합(지표만 갱신, 어드민 값은 보존)
  const updatedDates: string[] = [];
  let spendChangeWarning: string | undefined;
  const prevDaily = deriveDaily(data.daily);

  for (const row of meta.daily) {
    const existing = byDate.get(row.date);
    // 지출 ±300% 급변 경고(기존 지출이 있을 때만)
    const prevSpend = existing?.spend ?? null;
    if (prevSpend && prevSpend > 0) {
      const change = Math.abs(row.spend - prevSpend) / prevSpend;
      if (change > 3) {
        spendChangeWarning = `${row.date} 지출이 전 값 대비 ${(change * 100).toFixed(0)}% 변동했습니다 (₩${prevSpend.toLocaleString()} → ₩${row.spend.toLocaleString()}).`;
      }
    }
    const merged: DailyRecord = {
      date: row.date,
      leads: existing?.leads ?? null,
      ...(existing?.planSnapshot ? { planSnapshot: existing.planSnapshot } : {}),
      openTalkCum: existing?.openTalkCum ?? null,
      spend: row.spend,
      impressions: row.impressions,
      clicks: row.clicks,
      ctr: row.ctr,
      cpm: row.cpm,
      frequency: row.frequency,
      openEvents: row.openEvents,
    };
    byDate.set(row.date, merged);
    updatedDates.push(row.date);
  }

  // 어드민 입력 반영(입력일 레코드)
  const target = byDate.get(input.date) || {
    date: input.date,
    leads: null,
    openTalkCum: null,
    spend: null,
    impressions: null,
    clicks: null,
    ctr: null,
    cpm: null,
    frequency: null,
    openEvents: null,
  };
  target.leads = input.leads;
  if (input.openTalkCum != null) target.openTalkCum = input.openTalkCum;
  if (!target.planSnapshot) {
    const snap = replanForDate(data, input.date);
    if (snap) target.planSnapshot = snap;
  }
  byDate.set(input.date, target);

  // 세트별 병합: 수집 범위 내 날짜의 기존 adset 제거 후 새 값으로 교체
  const rangeDates = new Set(meta.adsets.map((a) => a.date));
  const keptAdsets = data.adsets.filter((a) => !rangeDates.has(a.date));
  const newAdsets = [...keptAdsets, ...meta.adsets];

  const nextDaily = [...byDate.values()].sort((a, b) => dayIndex(a.date) - dayIndex(b.date));

  // 소재(광고) 성과 + 썸네일 갱신 (실패해도 인제스트 전체를 막지 않되, 원인은 폼에 노출)
  let creatives = data.creatives;
  let creativeRefreshError: string | undefined;
  try {
    const perf = await fetchCreativePerformance(input.date, data.goals.startDate, input.date, 16);
    creatives = perf;
  } catch (e: any) {
    creativeRefreshError = `소재 갱신 실패(기존 데이터 유지): ${e?.message ?? String(e)}`;
  }

  const next: Dataset = {
    ...data,
    meta: { ...data.meta, lastUpdated: new Date(nowMs).toISOString() },
    daily: nextDaily,
    adsets: newAdsets,
    creatives,
  };

  void prevDaily; // (확장 여지) 이전 파생값 비교 자리

  const saveRes = await saveDataset(
    next,
    `data: ${input.date} 알림 +${input.leads.toLocaleString()}명 · 메타 갱신 (${updatedDates.join(", ")})`
  );

  return {
    saved: true,
    committed: saveRes.committed,
    wroteLocal: saveRes.wroteLocal,
    spendChangeWarning,
    creativeRefreshError,
    discoveredActionTypes: meta.discoveredActionTypes,
    openEventActionType: meta.openEventActionType,
    updatedDates,
    dataset: next,
  };
}
