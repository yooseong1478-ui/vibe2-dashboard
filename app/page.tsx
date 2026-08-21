import { getDataset } from "@/lib/dataStore";
import { computeView, computeSignalHistory, bandsForDate, dayIndex, planForDate, todayKST, diffDays } from "@/lib/metrics";
import { won, num, pct, money, eok, shortDate } from "@/lib/format";
import HomeCharts from "@/components/HomeCharts";
import { getTestingAdsCached } from "@/lib/meta";
import AdsetSection, { type AdsetRow } from "@/components/AdsetSection";
import CreativeSection from "@/components/CreativeSection";
import ThemeToggle from "@/components/ThemeToggle";
import SecNav from "@/components/SecNav";
import { computeLanding } from "@/lib/landing";

const DOT: Record<string, string> = { green: "🟢", yellow: "🟡", freeze: "🟠", red: "🔴", gray: "⚪" };

export const dynamic = "force-dynamic";

// 계산식·출처는 본문에서 빼고 ⓘ 툴팁으로
function Tip({ text }: { text: string }) {
  return (
    <span className="tip" data-tip={text} aria-label={text} role="img">
      ⓘ
    </span>
  );
}

export default async function DashboardPage() {
  const { data, error } = await getDataset();

  if (!data) {
    return (
      <main className="wrap" style={{ paddingTop: 24 }}>
        <div className="banner err">대시보드 데이터를 불러오지 못했습니다. {error}</div>
      </main>
    );
  }

  const now = Date.now();
  const v = computeView(data, now);
  const g = data.goals;

  // ── 차트 시리즈 ──
  const labels = v.planCurve.map((p) => shortDate(p.date));
  const planPerDay = v.planCurve.map((p) => p.perDay);
  const planSpendDaily = v.planCurve.map((p) => p.dailyBudget);
  const planCumSpend = v.planCurve.map((p) => p.cumSpend);
  const planCumLeads = v.planCurve.map((p) => p.cumLeads);

  const dailyByDate = new Map(v.derived.map((d) => [d.date, d]));
  let runSpend = 0;
  const latestDataIdx = v.latestDataDate ? dayIndex(v.latestDataDate) : -Infinity;
  const actualDaily: (number | null)[] = [];
  const actualCumSpend: (number | null)[] = [];
  const actualCumLeads: (number | null)[] = [];
  for (const p of v.planCurve) {
    const rec = dailyByDate.get(p.date);
    actualDaily.push(rec?.dailyLeads ?? null);
    if (rec?.spend != null) runSpend += rec.spend;
    actualCumSpend.push(rec?.spend != null && dayIndex(p.date) <= latestDataIdx ? runSpend : null);
    actualCumLeads.push(rec?.leadsCum ?? null);
  }
  // 페이스 갭 = 누적 실측 − 누적 목표 (실측이 있는 날만)
  const gapLeads = actualCumLeads.map((a, i) => (a == null ? null : a - planCumLeads[i]));
  const gapSpend = actualCumSpend.map((a, i) => (a == null ? null : a - planCumSpend[i]));

  const liveDates = g.liveDates?.length ? g.liveDates : [g.webinarDate];
  const liveIdx = liveDates.map((d) => v.planCurve.findIndex((p) => p.date === d)).filter((i) => i >= 0);
  const liveLabel = `LIVE ${liveDates.map(shortDate).join("~")}`;
  const today = todayKST(now);
  const dDay = diffDays(today, liveDates[0]);

  const hasActual = v.derived.some((d) => d.spend != null || d.dailyLeads != null);
  const hasLeads = v.leadsCum !== null;

  // 일 CPA + 3일 이동
  const complete = v.derived.filter((d) => d.cpaAdmin !== null && d.spend !== null);
  const rollByDate = new Map<string, number>();
  for (let i = 0; i < complete.length; i++) {
    const win = complete.slice(Math.max(0, i - 2), i + 1);
    const sp = win.reduce((s2, d) => s2 + (d.spend ?? 0), 0);
    const ld = win.reduce((s2, d) => s2 + (d.dailyLeads ?? 0), 0);
    if (ld) rollByDate.set(complete[i].date, sp / ld);
  }
  const cpaDaily = v.planCurve.map((p) => dailyByDate.get(p.date)?.cpaAdmin ?? null);
  const cpaRolling = v.planCurve.map((p) => rollByDate.get(p.date) ?? null);
  // 구간별 신호등 밴드 (P1 6,500/9,000/11,000 · P2 8,500/12,000/14,000 · P3·D 9,000/13,000/18,000)
  const zones = v.planCurve.map((p) => bandsForDate(data, p.date));
  const capCpa = v.capToday; // 오늘 구간의 동결 상한 — 소재/세트 뱃지 기준
  const cpaClass = (cpa: number | null, date: string) => {
    if (cpa === null) return "";
    const b = bandsForDate(data, date);
    return cpa <= b.green ? "pos" : cpa <= b.yellow ? "" : cpa <= b.freeze ? "warn" : "neg";
  };

  const s = v.signal;
  const history = computeSignalHistory(v.derived, data, 7);

  // ── 착지 3시나리오 (낙관/기준/보수) + 착지 밴드 vs 목표 판정 ──
  const landing = computeLanding(data, v.derived, now);
  const LDOT: Record<string, string> = { green: "🟢", yellow: "🟡", red: "🔴", gray: "⚪" };
  const LMSG: Record<string, string> = {
    green: "안전 — 보수 시나리오도 목표 이상",
    yellow: "유지 · CPA 감시 — 기준은 목표 이상, 보수는 미달",
    red: "증액 or 소재 교체 트리거 — 기준 시나리오가 목표 미달",
    gray: "실측 대기",
  };
  // 판단 카드 배경은 CPA 신호와 착지 신호 중 나쁜 쪽
  const RANK: Record<string, number> = { green: 0, yellow: 1, freeze: 2, red: 3, gray: 0 };
  const cardLevel = RANK[landing.signal] > RANK[s.level] ? landing.signal : s.level;

  // 전일(최신 완결일) 실측 + 그 날짜의 플랜
  const lastC = complete.length ? complete[complete.length - 1] : null;
  const lastPlan = lastC ? planForDate(data, lastC.date) : null;
  const lastVsPlan = lastC?.dailyLeads != null && lastPlan?.perDay ? (lastC.dailyLeads / lastPlan.perDay) * 100 : null;

  // 누적 3카드 앵커 — 알림 최신일(asOf) 우선, 없으면 지표 최신일 기준 당일 목표
  const anchorDate = v.asOfDate ?? v.latestDataDate;
  let planAnchor: (typeof v.planCurve)[number] | null = null;
  if (anchorDate) {
    for (const p of v.planCurve) {
      if (dayIndex(p.date) <= dayIndex(anchorDate)) planAnchor = p;
      else break;
    }
  }
  const totalSpendAll = v.derived.reduce((s2, d) => s2 + (d.spend ?? 0), 0);
  const spendCumDisplay = v.asOfDate ? v.spendCum ?? totalSpendAll : totalSpendAll;
  const spendAchieve = planAnchor?.cumSpend ? (spendCumDisplay / planAnchor.cumSpend) * 100 : null;
  const leadsDelta = (v.leadsCum ?? 0) - (planAnchor?.cumLeads ?? 0);
  const spendDelta = spendCumDisplay - (planAnchor?.cumSpend ?? 0);
  const openEventsAll = v.derived.reduce((s2, d) => s2 + (d.openEvents ?? 0), 0);
  const pixelCpaAll = openEventsAll ? totalSpendAll / openEventsAll : null;

  // 잔여 예산 — 알림 입력 여부와 무관하게 전체 지출 기준으로 항상 계산
  const remBudget = g.totalBudget - totalSpendAll;

  // ── 기대수익 시나리오 (1차 웨비나 2.5~3.5% / 종합 5.5~6.5%, 기준 6.0%) ──
  const rc0 = g.revConv as any;
  const rc = {
    w1Low: rc0?.w1Low ?? 0.02,
    w1High: rc0?.w1High ?? 0.03,
    w1Base: rc0?.w1Base ?? 0.025,
    finalLow: rc0?.finalLow ?? 0.045,
    finalHigh: rc0?.finalHigh ?? 0.06,
    finalBase: rc0?.finalBase ?? 0.05,
  };
  const revBase = hasLeads ? (v.leadsCum as number) : g.targetLeads; // 실측 전엔 목표 기준
  const revBaseLabel = hasLeads ? `누적 ${num(v.leadsCum)}명` : `목표 ${num(g.targetLeads)}명 기준`;

  // ── 세트 ──
  const adsetDates = [...new Set(data.adsets.map((a) => a.date))].sort();
  const aggMap = new Map<string, AdsetRow>();
  for (const a of data.adsets) {
    const cur = aggMap.get(a.adsetId) || { adsetId: a.adsetId, name: a.name, campaignId: a.campaignId, spend: 0, impressions: 0, clicks: 0, openEvents: 0 };
    cur.spend += a.spend; cur.impressions += a.impressions; cur.clicks += a.clicks; cur.openEvents += a.openEvents;
    cur.name = a.name;
    aggMap.set(a.adsetId, cur);
  }
  const adsetLatest: AdsetRow[] = v.latestAdsets.map((a) => ({
    adsetId: a.adsetId, name: a.name, campaignId: a.campaignId, spend: a.spend, impressions: a.impressions, clicks: a.clicks, openEvents: a.openEvents,
  }));

  // ── 소재 테스트 현황 한 줄 ──
  const testing = await getTestingAdsCached(now).catch(() => null);
  let testLine = "";
  if (testing?.items.length) {
    let settled = 0, learning = 0, risky = 0;
    for (const ad of testing.items) {
      if (ad.impressions < 500) { learning++; continue; }
      const cpa = ad.openEvents ? ad.spend / ad.openEvents : Infinity;
      const tb = bandsForDate(data, today);
      if (cpa <= tb.yellow) settled++;
      else if (cpa > tb.freeze) risky++;
    }
    testLine = `🧪 테스트 ${testing.items.length}개 진행 중 (✅ 승자 ${settled} · 🌱 육성 ${learning} · 🔴 종료 ${risky})`;
  }

  // ── 현재 주차 ──
  const curStep = data.plan.find((p) => diffDays(p.from, today) >= 0 && diffDays(today, p.to) >= 0) ?? data.plan[0];
  const curStepNo = data.plan.indexOf(curStep) + 1;
  const todayPlan = planForDate(data, today);

  // KPI 행 카드 수 (값 없는 카드는 접고 열 수 자동 조정)
  const kpiCols = 2 + (lastC ? 1 : 0) + (landing.base !== null ? 1 : 0);

  // ── 게이트 자동 판정 ──
  // cum 게이트 기준값 = 플랜 "명목" 누적 (plan steps 에서 직접 계산).
  // planCurve 는 실측 앵커 이후를 실측+플랜으로 재산정하므로 게이트 기준으로 쓰면
  // 실측이 뒤처질수록 기준도 낮아지는 순환이 생긴다 — 게이트는 절대 기준이어야 한다.
  const planCumAt = (iso: string) => {
    let cum = 0;
    let any = false;
    for (const pp of data.plan) {
      if (diffDays(pp.from, iso) < 0) break;
      // iso 가 구간 끝을 지났으면 구간 전체, 아니면 iso 까지 부분 합산
      const end = diffDays(pp.to, iso) >= 0 ? pp.to : iso;
      cum += pp.perDay * (diffDays(pp.from, end) + 1);
      any = true;
    }
    return any ? cum : null;
  };
  const gates = (g.gates ?? []).map((gt) => {
    const due = diffDays(gt.date, today) >= 0; // 판정일 도래
    let status: "pass" | "fail" | "wait" = "wait";
    let current = "";
    let target = "";
    if (gt.type === "cpa") {
      target = `3일 CPA ≤ ${won(gt.max ?? null)}`;
      current = v.rolling3Cpa != null ? `현재 ${won(v.rolling3Cpa)}` : "실측 대기";
      if (due && v.rolling3Cpa != null) status = v.rolling3Cpa <= (gt.max ?? Infinity) ? "pass" : "fail";
    } else {
      const base = planCumAt(gt.date);
      const tol = gt.tolerance ?? 0;
      const min = base != null ? Math.round(base * (1 - tol)) : null;
      target = base != null ? `누적 ${num(base)} ±${Math.round(tol * 100)}%` : "";
      current = v.leadsCum != null ? `현재 ${num(v.leadsCum)}` : "실측 대기";
      if (due && v.leadsCum != null && min != null) status = v.leadsCum >= min ? "pass" : "fail";
    }
    return { ...gt, due, status, current, target };
  });

  return (
    <>
      <header className="header">
        <div className="brand">
          <div className="logo">V2</div>
          <div>
            <h1>바이브코딩 2기 현황판</h1>
            <div className="sub">
              목표 {num(g.targetLeads)}명 · 알림 마감 {shortDate(g.webinarDate)}
              {dDay > 0 ? ` (D-${dDay})` : dDay === 0 ? " (D-DAY)" : ""} · LIVE {liveDates.map(shortDate).join("·")}
            </div>
          </div>
        </div>
        <div className="header-right">
          {v.rolling3Cpa != null && (
            <span className="chip mute" title={s.reason}>{DOT[s.level]} {won(v.rolling3Cpa)}</span>
          )}
          <ThemeToggle />
          <a className="btn-primary" href="/admin">입력 →</a>
        </div>
      </header>

      <SecNav
        items={[
          { id: "signal", label: "판단" },
          ...(gates.length > 0 ? [{ id: "gates", label: "게이트" }] : []),
          { id: "cum", label: "누적" },
          { id: "kpi", label: "KPI" },
          { id: "revenue", label: "수익" },
          { id: "trend", label: "추이" },
          { id: "creatives", label: "소재" },
          { id: "adsets", label: "세트" },
          { id: "plan", label: "플랜" },
          { id: "dailytable", label: "일별" },
        ]}
      />

      <main className="wrap">
        {/* 1. 오늘의 판단 — CPA + 착지밴드 이중 판정 */}
        <div className="section" id="signal">
          <div className={`signal ${cardLevel}`}>
            <div className="dot">{DOT[cardLevel]}</div>
            <div className="body">
              <div className="t">
                {s.rolling3Cpa === null ? "데이터 수집 중" : s.label}
                {s.stale && <span className="badge">갱신 필요</span>}
              </div>
              <div className="r">
                {s.rolling3Cpa === null
                  ? `${shortDate(g.startDate)} 집행 시작 · 알림신청 입력 대기`
                  : `CPA ${DOT[s.level]} 3일 이동 ${won(s.rolling3Cpa)} (캡 ${won(v.capToday)})`}
              </div>
              {landing.signal !== "gray" && (
                <div className="r">
                  착지 {LDOT[landing.signal]} 보수 {num(landing.conservative)} ~ 낙관 {num(landing.optimistic)} (기준{" "}
                  {num(landing.base)}) vs 목표 {num(g.targetLeads)} — {LMSG[landing.signal]}
                </div>
              )}
              {history.length > 0 && (
                <div className="sighist">
                  {history.map((h) => (
                    <span key={h.date} className="sigday" title={`${h.date} · ${h.cpa ? won(h.cpa) : "—"}`}>
                      <span className="d">{DOT[h.level]}</span>
                      <span className="dt">{shortDate(h.date)}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 1.5 게이트 — 의사결정 포인트 자동 판정 */}
        {gates.length > 0 && (
          <div className="section" id="gates">
            <div className="eyebrow">게이트 <span className="desc">의사결정 포인트 · 기준 미달 시 조치 실행</span></div>
            <div className="card toplist">
              {gates.map((gt) => (
                <div key={gt.date} className="toprow gaterow">
                  <span className="rk">{gt.status === "pass" ? "🟢" : gt.status === "fail" ? "🔴" : "⏳"}</span>
                  <span className="nm">
                    <b>{shortDate(gt.date)}</b> {gt.label} · {gt.target}
                    <span className="gsub">{gt.status === "fail" ? gt.action : gt.current}</span>
                  </span>
                  <span className={`chip ${gt.status === "pass" ? "pos" : gt.status === "fail" ? "neg" : "mute"}`}>
                    {gt.status === "pass" ? "통과" : gt.status === "fail" ? "미달" : "대기"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 2. 누적 3카드 — 당일 누적 목표 대비 */}
        <div className="section" id="cum">
          <div className="eyebrow">누적 <span className="desc">당일 누적 목표 대비</span></div>
          <div className="grid grid-3">
            <div className="card kpi">
              <div className="label">누적 알림신청</div>
              <div className="value">
                {hasLeads ? num(v.leadsCum) : "—"} <span className="unit">/ {num(g.targetLeads)}</span>
              </div>
              <div className="foot">
                {hasLeads ? (
                  <>
                    진척 {pct(v.goalProgress, 1)}
                    <span className={`chip ${leadsDelta >= 0 ? "pos" : "neg"}`} title="당일 누적 목표 대비">
                      계획 대비 {num(leadsDelta, { sign: true })}명
                    </span>
                  </>
                ) : (
                  <span className="chip mute">⚪ 수집 중</span>
                )}
              </div>
              <div className="pbar"><i style={{ width: `${Math.min(100, v.goalProgress ?? 0)}%` }} /></div>
            </div>
            <div className="card kpi">
              <div className="label">누적 지출</div>
              <div className="value">
                {money(spendCumDisplay)} <span className="unit">/ {money(planAnchor?.cumSpend ?? null)}</span>
              </div>
              <div className="foot">
                집행 {pct(spendAchieve, 0)}
                <span className={`chip ${spendDelta <= 0 ? "pos" : "warn"}`}>{spendDelta > 0 ? "+" : ""}{money(spendDelta)}</span>
              </div>
            </div>
            <div className="card kpi">
              <div className="label">
                누적 CPA <Tip text={`누적 지출 ÷ 누적 알림신청. 하드캡 ${won(v.capToday)} · 블렌디드 목표 ${won(g.targetCpa ?? null)}`} />
              </div>
              <div className="value">{hasLeads ? won(v.cpaAdmin) : "—"}</div>
              <div className="foot">
                {hasLeads ? (
                  <>
                    <span className={`chip ${(v.cpaHeadroom ?? 0) >= 0 ? "pos" : "neg"}`}>
                      캡 여유 {pct(((v.cpaHeadroom ?? 0) / v.capToday) * 100, 0, { sign: true })}
                    </span>
                    {v.cpaGapPct !== null && (
                      <span className={`chip ${v.cpaGapWarn ? "warn" : "mute"}`} title="어드민 기준 CPA와 픽셀(openEvent) 기준 CPA의 차이">
                        픽셀 괴리 {pct(v.cpaGapPct, 0, { sign: true })}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="chip mute">픽셀 기준 {won(pixelCpaAll)}</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 3. KPI 4카드 */}
        <div className="section" id="kpi">
          <div className="eyebrow">KPI</div>
          <div className={`grid grid-${kpiCols}`}>
            <div className="card kpi">
              <div className="label">오늘 필요 인원</div>
              <div className="value">{num(v.todayRequired)}<span className="unit">/일</span></div>
              <div className="foot">
                {lastC ? (
                  <>
                    어제 실측 {num(lastC.dailyLeads)}
                    <span className={`chip ${(lastVsPlan ?? 0) >= 100 ? "pos" : "mute"}`}>플랜 대비 {pct(lastVsPlan, 0)}</span>
                  </>
                ) : (
                  <span className="chip mute">⚪ 수집 중</span>
                )}
              </div>
            </div>

            <div className="card kpi">
              <div className="label">잔여 예산</div>
              <div className={`value ${remBudget < 0 ? "neg" : ""}`}>{money(remBudget)}</div>
              <div className="foot">
                <span className={`chip ${remBudget < 0 ? "neg" : "mute"}`}>총예산 대비 {pct((remBudget / g.totalBudget) * 100, 0)}</span>
              </div>
            </div>

            {lastC && (
              <div className="card kpi">
                <div className="label">어제 CPA</div>
                <div className={`value ${cpaClass(lastC.cpaAdmin, lastC.date)}`}>{won(lastC.cpaAdmin)}</div>
                <div className="foot">
                  3일 이동 {won(v.rolling3Cpa)}
                  <span className="chip mute">{shortDate(lastC.date)}</span>
                </div>
              </div>
            )}

            {landing.base !== null && (
              <div className="card kpi">
                <div className="label">
                  예상 착지 <Tip text={`낙관 = 잔여예산 ÷ 3일CPA(${won(landing.cpa3)}) · 기준 = 잔여×0.95 ÷ 7일CPA(${won(landing.cpa7)})×k${landing.k.toFixed(2)} (스케일업 ${landing.scaleRatio ? "×" + landing.scaleRatio.toFixed(1) : "—"}) · 보수 = 잔여×0.90 ÷ 잔여플랜 CPA(${won(landing.planCpaRemaining)}). "계획 대비 %" 선형 외삽은 쓰지 않는다.`} />
                </div>
                <div className="value">{num(landing.base)}<span className="unit">명</span></div>
                <div className="foot">
                  {num(landing.conservative)} ~ {num(landing.optimistic)}
                  <span className={`chip ${landing.signal === "green" ? "pos" : landing.signal === "red" ? "neg" : "warn"}`}>
                    {LDOT[landing.signal]} 목표 대비 {pct(((landing.base ?? 0) / g.targetLeads) * 100, 0)}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 4. 기대수익 3카드 — 1차 웨비나 2.5~3.5% / 최종 5.0% */}
        <div className="section" id="revenue">
          <div className="eyebrow">
            기대수익{" "}
            <span className="desc">
              객단가 {money(g.aov)}원 · 1차 {pct(rc.w1Low * 100, 1)}~{pct(rc.w1High * 100, 1)} (기준 {pct(rc.w1Base * 100, 1)}) / 종합 {pct(rc.finalLow * 100, 1)}~{pct(rc.finalHigh * 100, 1)} (기준 {pct(rc.finalBase * 100, 1)})
            </span>
          </div>
          <div className="grid grid-3">
            <div className="card rev">
              <div className="rlabel">1차 웨비나 기준</div>
              <div className="n">{eok(revBase * rc.w1Low * g.aov)} ~ {eok(revBase * rc.w1High * g.aov)}</div>
              <div className="band">{num(revBase * rc.w1Low)}~{num(revBase * rc.w1High)}건 · {revBaseLabel}</div>
              <span className="corner">{pct(rc.w1Low * 100, 1)}~{pct(rc.w1High * 100, 1)}</span>
            </div>
            <div className="card rev">
              <div className="rlabel">종합 (2차 + VOD + 강의판매)</div>
              <div className="n">{eok(revBase * rc.finalLow * g.aov)} ~ {eok(revBase * rc.finalHigh * g.aov)}</div>
              <div className="band">기준 {pct(rc.finalBase * 100, 1)} = {eok(revBase * rc.finalBase * g.aov)} · {revBaseLabel}</div>
              <span className="corner goal">{pct(rc.finalLow * 100, 1)}~{pct(rc.finalHigh * 100, 1)}</span>
            </div>
            {landing.base !== null ? (
              <div className="card rev">
                <div className="rlabel">
                  착지 시나리오 <Tip text="최저선 = 보수 착지 × 종합 하한 4.5% — 이중 낙관(낙관 착지 × 낙관 전환) 방지용 대표 하단. 상단 = 낙관 착지 × 상한 6.0%." />
                </div>
                <div className="revrows">
                  <div><span>최저선</span><b>{eok((landing.conservative ?? 0) * rc.finalLow * g.aov)}</b><i>보수 {num(landing.conservative)} × {pct(rc.finalLow * 100, 1)}</i></div>
                  <div><span>기준</span><b>{eok((landing.base ?? 0) * rc.finalBase * g.aov)}</b><i>기준 {num(landing.base)} × {pct(rc.finalBase * 100, 1)}</i></div>
                  <div><span>상단</span><b>{eok((landing.optimistic ?? 0) * rc.finalHigh * g.aov)}</b><i>낙관 {num(landing.optimistic)} × {pct(rc.finalHigh * 100, 1)}</i></div>
                </div>
              </div>
            ) : (
              <div className="card rev">
                <div className="rlabel">착지 시나리오</div>
                <div className="n">—</div>
                <div className="band"><span className="chip mute">⚪ 수집 중</span></div>
              </div>
            )}
          </div>
        </div>

        {/* 5. 추이 차트 A~D */}
        <div className="section" id="trend">
          <div className="eyebrow">추이 <span className="desc">실측 vs 계획</span></div>
          {!hasActual && (
            <div className="banner info" style={{ margin: "0 0 12px" }}>
              실측 대기 — {shortDate(g.startDate)} 집행분부터 자동 수집됩니다. 아래는 계획선입니다.
            </div>
          )}
          <HomeCharts
            labels={labels}
            planPerDay={planPerDay}
            actualDaily={actualDaily}
            cpaDaily={cpaDaily}
            cpaRolling={cpaRolling}
            zones={zones}
            planSpendDaily={planSpendDaily}
            spendDaily={v.planCurve.map((p) => dailyByDate.get(p.date)?.spend ?? null)}
            gapLeads={gapLeads}
            gapSpend={gapSpend}
            liveFrom={liveIdx.length ? liveIdx[0] : -1}
            liveTo={liveIdx.length ? liveIdx[liveIdx.length - 1] : -1}
            liveLabel={liveLabel}
          />
        </div>

        {/* 6. 소재 TOP5 + 테스트 현황 한 줄 */}
        {data.creatives && data.creatives.items.length > 0 ? (
          <CreativeSection block={data.creatives} compact capCpa={capCpa} />
        ) : null}
        <div className="section" {...(data.creatives?.items.length ? {} : { id: "creatives" })}>
          <a href="/creatives" className="card testline">
            <span>{testLine || "🎨 소재 상세"}</span>
            <span className="tarrow">전체 보기 →</span>
          </a>
        </div>

        {/* 7. 세트별 성과 */}
        <AdsetSection
          latest={adsetLatest}
          latestDate={v.latestAdsetDate}
          agg={[...aggMap.values()]}
          aggFrom={adsetDates[0] ?? null}
          aggTo={adsetDates[adsetDates.length - 1] ?? null}
          capCpa={capCpa}
          mainCampaignId={data.meta.campaignIds[0] ?? null}
          sectionId="adsets"
        />

        {/* 8. 주차별 플랜 — 현재 주차 한 줄 + 전체 아코디언 */}
        <div className="section" id="plan">
          <div className="card oneline">
            <span className="ol-label">{curStep.name ?? `${curStepNo}구간`}</span>
            <span className="ol-main">
              {shortDate(curStep.from)}~{shortDate(curStep.to)} · 주 목표 <b>{num(curStep.perDay * curStep.days)}명</b> · 주 예산{" "}
              {money(curStep.dailyBudget * curStep.days)} · 목표 CPA {won(curStep.targetCpa)}
            </span>
          </div>
          <details style={{ marginTop: 8 }}>
            <summary>전체 플랜 보기</summary>
            <div className="card table-scroll" style={{ marginTop: 8 }}>
              <table>
                <thead>
                  <tr><th>주차</th><th>일수</th><th>주 목표</th><th>주 예산</th><th>목표 CPA</th><th>필요/일</th><th>일예산</th></tr>
                </thead>
                <tbody>
                  {data.plan.map((p, i) => (
                    <tr key={p.from} className={p === curStep ? "total" : ""}>
                      <td>{p.name ?? `${i + 1}구간`} {shortDate(p.from)}~{shortDate(p.to)}</td>
                      <td className="mono">{p.days}일</td>
                      <td className="mono">{num(p.perDay * p.days)}</td>
                      <td className="mono">{money(p.dailyBudget * p.days)}</td>
                      <td className="mono">{won(p.targetCpa)}</td>
                      <td className="mono">{num(p.perDay)}</td>
                      <td className="mono">{money(p.dailyBudget)}</td>
                    </tr>
                  ))}
                  <tr className="total">
                    <td>합계</td>
                    <td className="mono">{data.plan.reduce((a, p) => a + p.days, 0)}일</td>
                    <td className="mono">{num(data.plan.reduce((a, p) => a + p.perDay * p.days, 0))}</td>
                    <td className="mono">{money(data.plan.reduce((a, p) => a + p.dailyBudget * p.days, 0))}</td>
                    <td className="mono">{won(g.targetCpa ?? null)}</td>
                    <td className="mono">—</td>
                    <td className="mono">—</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </details>
        </div>

        {/* 9. 일별 실측 */}
        <div className="section" id="dailytable">
          <div className="eyebrow">일별 실측</div>
          <div className="card table-scroll">
            <table>
              <thead>
                <tr><th>날짜</th><th>지출</th><th>알림</th><th>openEvent</th><th>CPA</th><th>CTR</th><th>CPM</th><th>빈도</th></tr>
              </thead>
              <tbody>
                {v.derived.map((d) => (
                  <tr key={d.date}>
                    <td>{shortDate(d.date)}</td>
                    <td className="mono">{won(d.spend)}</td>
                    <td className="mono">{num(d.dailyLeads)}</td>
                    <td className="mono">{num(d.openEvents)}</td>
                    <td className={`mono ${cpaClass(d.cpaAdmin, d.date)}`} style={{ fontWeight: 700 }}>{won(d.cpaAdmin)}</td>
                    <td className="mono">{pct(d.ctr, 2)}</td>
                    <td className="mono">{won(d.cpm)}</td>
                    <td className="mono">{d.frequency ?? "—"}</td>
                  </tr>
                ))}
                {v.derived.length === 0 && (
                  <tr><td colSpan={8} style={{ textAlign: "center", color: "hsl(var(--text-3))" }}>실측 대기</td></tr>
                )}
                <tr className="total">
                  <td>누적</td>
                  <td className="mono">{won(totalSpendAll)}</td>
                  <td className="mono">{num(v.leadsCum)}</td>
                  <td className="mono">{num(openEventsAll)}</td>
                  <td className="mono">{won(v.cpaAdmin)}</td>
                  <td className="mono">—</td>
                  <td className="mono">—</td>
                  <td className="mono">—</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="footer-links">
          최종 갱신 {new Date(Date.parse(data.meta.lastUpdated)).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} ·{" "}
          <a href="/admin">데이터 입력</a> · <a href="/gen1">1기 아카이브 보기</a>
        </div>
      </main>
    </>
  );
}
