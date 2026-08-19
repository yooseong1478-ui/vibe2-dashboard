// 1기 벤치마크 비교 — data/vibe1.json (고정 스냅샷) 과 2기 실측을 D-day 정렬로 맞춘다.
// 원칙은 metrics.ts 와 동일: JSON 에는 원본만, CPM·CPC·CTR·CPA·배수는 전부 여기서 계산.

import type { Dataset } from "./types";
import { dayIndex, diffDays, type DailyDerived, type PlanPoint } from "./metrics";

// ── 벤치마크(1기) 스키마 ─────────────────────────────────────────
export interface BenchDaily {
  date: string;
  leads: number;
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  sales: number;
  revenue: number;
  inPeriod: boolean;
}

export interface BenchLiveSession {
  date: string;
  label: string;
  openChat: number;
  openAlert: number;
  viewers: number;
  viewerRate: number;
  sales: number;
  revenue: number;
  buyRate: number;
}

export interface Benchmark {
  meta: {
    cohort: string;
    campaignName: string;
    trackedFrom: string;
    trackedTo: string;
    projectFrom: string;
    projectTo: string;
    source: string;
    note: string;
  };
  live: { date: string; label: string }[];
  goals: { targetLeads: number; aov: number; conversionRate: number };
  daily: BenchDaily[];
  totals: {
    leads: number;
    spend: number;
    impressions: number;
    clicks: number;
    sales: number;
    revenue: number;
  };
  liveSessions: BenchLiveSession[];
  salesSplit: Record<
    string,
    { label: string; sales: number; revenue: number; salesShare: number; revenueShare: number }
  >;
  products: { type: string; price: number; priceLabel: string; sales: number; share: number; note: string }[];
  reported: Record<string, number | string>;
}

// ── 1기 집계(파생) ───────────────────────────────────────────────
export interface BenchSummary {
  leads: number;
  spend: number;
  impressions: number;
  clicks: number;
  sales: number;
  revenue: number;
  cpa: number;          // 지출 ÷ 알림신청
  cpc: number;
  cpm: number;
  ctr: number;          // %
  buyRate: number;      // 판매건수 ÷ 알림신청 (%)
  aov: number;          // 매출 ÷ 판매건수
  roas: number;         // 매출 ÷ 지출 (%)
  days: number;         // 광고 집행일수
  peakLeads: { date: string; leads: number };
  peakSpend: { date: string; spend: number };
  live1: string;        // 1차 LIVE 날짜
  live2: string | null; // 2차 LIVE 날짜
}

export function summarizeBenchmark(b: Benchmark): BenchSummary {
  const t = b.totals;
  const spendDays = b.daily.filter((d) => (d.spend ?? 0) > 0);
  const peakLeads = b.daily.reduce((a, d) => (d.leads > a.leads ? d : a), b.daily[0]);
  const peakSpend = spendDays.reduce((a, d) => ((d.spend ?? 0) > (a.spend ?? 0) ? d : a), spendDays[0]);
  return {
    leads: t.leads,
    spend: t.spend,
    impressions: t.impressions,
    clicks: t.clicks,
    sales: t.sales,
    revenue: t.revenue,
    cpa: t.spend / t.leads,
    cpc: t.spend / t.clicks,
    cpm: (t.spend / t.impressions) * 1000,
    ctr: (t.clicks / t.impressions) * 100,
    buyRate: (t.sales / t.leads) * 100,
    aov: t.revenue / t.sales,
    roas: (t.revenue / t.spend) * 100,
    days: spendDays.length,
    peakLeads: { date: peakLeads.date, leads: peakLeads.leads },
    peakSpend: { date: peakSpend.date, spend: peakSpend.spend ?? 0 },
    live1: b.live[0]?.date ?? "",
    live2: b.live[1]?.date ?? null,
  };
}

// ── D-day 정렬 비교 ──────────────────────────────────────────────
// 두 기수는 시작일이 다르므로 달력 날짜로 겹쳐보면 의미가 없다.
// 1차 LIVE 를 D0 으로 두고 상대 일자(D-21 … D+13)로 맞춘다.
export interface ComparePoint {
  d: number;                     // D-day (음수 = LIVE 이전)
  label: string;                 // "D-14"
  date1: string | null;
  date2: string | null;
  leads1: number | null;
  leads2: number | null;
  cum1: number | null;
  cum2: number | null;
  cum1Scaled: number | null;     // 1기 누적 × (2기 목표 ÷ 1기 최종) — "1기와 같은 곡선" 기준선
  bench1Live: boolean;           // 이 D-day 에 1기가 집행 중이었는지 (2기가 6일 일찍 시작해 앞 구간은 false)
  spend1: number | null;
  spend2: number | null;
  cumSpend1: number | null;
  cumSpend2: number | null;
  cpa1: number | null;
  cpa2: number | null;
  planCum2: number | null;       // 2기 목표 누적
}

export interface CompareView {
  points: ComparePoint[];        // 2기 캠페인 창(D-21~D+2)으로 잘린 구간만
  scale: number;                 // 목표 배수 = 2기 목표 ÷ 1기 최종 알림
  budgetScale: number;           // 예산 배수
  // LIVE 구간 밴드 (1·2기 모두 D0 ~ D+2). 세로선 2개는 라벨이 겹쳐서 음영 밴드 하나로 그린다.
  liveBand: { fromIndex: number; toIndex: number; label: string } | null;
  labelByDate1: Record<string, string>; // 1기 전체 날짜 → D-day 라벨 (창 밖 날짜도 포함, 원표용)
  today: {
    d: number | null;            // 2기 최신 실측의 D-day
    date2: string | null;
    cum2: number | null;
    cum1AtSameD: number | null;  // 같은 D-day 의 1기 누적
    ratio: number | null;        // 2기 ÷ 1기 (1기 미집행 구간이면 null)
    pace: number | null;         // 2기 ÷ (1기 × scale) — 1 이상이면 3만 페이스 위
    cpa2: number | null;
    cpa1AtSameD: number | null;
    bench1Live: boolean;         // 1기가 같은 D-day 에 집행 중이었는지
    leadDays: number;            // 2기가 1기보다 며칠 먼저 시작했는지
  };
}

export function buildCompare(
  bench: Benchmark,
  data: Dataset,
  derived: DailyDerived[],
  planCurve: PlanPoint[]
): CompareView {
  const live1B = bench.live[0].date;
  const live1C = data.goals.liveDates?.[0] ?? data.goals.webinarDate;
  const scale = data.goals.targetLeads / bench.totals.leads;
  const budgetScale = data.goals.totalBudget / bench.totals.spend;

  // 1기: D-day → 일별/누적
  const b1 = new Map<number, { date: string; leads: number; spend: number | null; cum: number; cumSpend: number }>();
  {
    const sorted = [...bench.daily].sort((a, b) => dayIndex(a.date) - dayIndex(b.date));
    let cum = 0;
    let cumSpend = 0;
    for (const r of sorted) {
      cum += r.leads;
      cumSpend += r.spend ?? 0;
      b1.set(diffDays(live1B, r.date), { date: r.date, leads: r.leads, spend: r.spend, cum, cumSpend });
    }
  }

  // 2기: D-day → 일별/누적 (실측)
  const b2 = new Map<number, { date: string; leads: number | null; spend: number | null; cum: number | null; cumSpend: number }>();
  {
    let cumSpend = 0;
    for (const r of derived) {
      cumSpend += r.spend ?? 0;
      b2.set(diffDays(live1C, r.date), {
        date: r.date,
        leads: r.dailyLeads,
        spend: r.spend,
        cum: r.leadsCum,
        cumSpend: r.spend !== null ? cumSpend : 0,
      });
    }
  }

  // 2기 목표 누적 (플랜 곡선) → D-day
  const plan2 = new Map<number, number>();
  for (const p of planCurve) plan2.set(diffDays(live1C, p.date), p.cumLeads);

  const dLabel = (d: number) => (d === 0 ? "D-DAY" : d < 0 ? `D${d}` : `D+${d}`);

  // 1기 전체 날짜의 D-day 라벨 (창 밖도 필요 — 1기 일별 원표에서 쓴다)
  const labelByDate1: Record<string, string> = {};
  for (const [d, r] of b1) labelByDate1[r.date] = dLabel(d);

  const dsAll = [...new Set([...b1.keys(), ...b2.keys(), ...plan2.keys()])].sort((a, b) => a - b);
  const first1D = Math.min(...b1.keys());

  // 비교 창 = 2기 캠페인 기간(플랜 곡선이 덮는 D 범위). 1기의 그 바깥 꼬리(신청 마감 후
  // 잔여 노출로 CPA 가 5만원대까지 튀는 구간)를 잘라내야 CPA 축이 정상 범위로 내려온다.
  const winFrom = plan2.size ? Math.min(...plan2.keys()) : Math.min(...dsAll);
  const winTo = plan2.size ? Math.max(...plan2.keys()) : Math.max(...dsAll);

  // 1기 누적은 계단식으로 이어붙인다. 2기가 6일 일찍 시작해 앞 구간에는 1기 행이 없는데,
  // 그때 1기 누적은 "없음"이 아니라 실제로 0 이다(아직 집행 전). 그래야 곡선이 같은 축에서 비교된다.
  let carryCum1 = 0;
  let carryCumSpend1 = 0;
  const allPoints: ComparePoint[] = dsAll.map((d) => {
    const r1 = b1.get(d) ?? null;
    const r2 = b2.get(d) ?? null;
    if (r1) {
      carryCum1 = r1.cum;
      carryCumSpend1 = r1.cumSpend;
    }
    return {
      d,
      label: dLabel(d),
      date1: r1?.date ?? null,
      date2: r2?.date ?? null,
      leads1: r1?.leads ?? null,
      leads2: r2?.leads ?? null,
      cum1: carryCum1,
      cum2: r2?.cum ?? null,
      cum1Scaled: Math.round(carryCum1 * scale),
      bench1Live: d >= first1D,
      spend1: r1?.spend ?? null,
      spend2: r2?.spend ?? null,
      cumSpend1: carryCumSpend1,
      cumSpend2: r2 && r2.spend !== null ? r2.cumSpend : null,
      cpa1: r1 && r1.spend && r1.leads ? r1.spend / r1.leads : null,
      cpa2: r2 && r2.spend && r2.leads ? r2.spend / r2.leads : null,
      planCum2: plan2.get(d) ?? null,
    };
  });

  const points = allPoints.filter((p) => p.d >= winFrom && p.d <= winTo);

  // LIVE 밴드 — 2기 LIVE 일자들을 D-day 로 변환해 첫~마지막 구간을 음영으로
  const liveDs = (data.goals.liveDates?.length ? data.goals.liveDates : [data.goals.webinarDate])
    .map((iso) => diffDays(live1C, iso))
    .filter((d) => d >= winFrom && d <= winTo)
    .sort((a, b) => a - b);
  const idxOf = (d: number) => points.findIndex((p) => p.d === d);
  const liveBand = liveDs.length
    ? {
        fromIndex: idxOf(liveDs[0]),
        toIndex: idxOf(liveDs[liveDs.length - 1]),
        label: liveDs.length > 1 ? "LIVE 구간" : "LIVE",
      }
    : null;

  // 오늘(2기 최신 실측일) 기준 비교
  const latest2 = [...points].reverse().find((p) => p.cum2 !== null) ?? null;
  const at = latest2 ? points.find((p) => p.d === latest2.d) ?? null : null;
  const cum1AtSameD = at?.cum1 ?? null;
  const cpa1AtSameD = at?.cpa1 ?? null;
  const bench1Live = at?.bench1Live ?? false;
  // 2기 시작이 1기보다 며칠 이른지 (D-day 기준)
  const first2D = b2.size ? Math.min(...b2.keys()) : first1D;
  const leadDays = first1D - first2D;

  return {
    points,
    scale,
    budgetScale,
    liveBand,
    labelByDate1,
    today: {
      d: latest2?.d ?? null,
      date2: latest2?.date2 ?? null,
      cum2: latest2?.cum2 ?? null,
      cum1AtSameD,
      ratio: latest2?.cum2 != null && cum1AtSameD ? latest2.cum2 / cum1AtSameD : null,
      pace: latest2?.cum2 != null && cum1AtSameD ? latest2.cum2 / (cum1AtSameD * scale) : null,
      cpa2: latest2?.cpa2 ?? null,
      cpa1AtSameD,
      bench1Live,
      leadDays,
    },
  };
}
