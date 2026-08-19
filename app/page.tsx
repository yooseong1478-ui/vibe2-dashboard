import { getDataset } from "@/lib/dataStore";
import { computeView, computeSignalHistory, dayIndex } from "@/lib/metrics";
import { won, num, pct, manwon, eok, money, shortDate } from "@/lib/format";
import Charts from "@/components/Charts";
import { getTestingAdsCached } from "@/lib/meta";
import CreativeSection from "@/components/CreativeSection";
import AdsetSection, { type AdsetRow } from "@/components/AdsetSection";
import CompareSection from "@/components/CompareSection";
import ThemeToggle from "@/components/ThemeToggle";
import SecNav from "@/components/SecNav";
import { summarizeBenchmark, buildCompare, type Benchmark } from "@/lib/benchmark";
import vibe1 from "@/data/vibe1.json";

const DOT: Record<string, string> = { green: "🟢", yellow: "🟡", freeze: "🟠", red: "🔴", gray: "⚪" };

export const dynamic = "force-dynamic";

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

  // 1기 벤치마크 — data/vibe1.json 고정 스냅샷, 1차 LIVE 를 D0 로 맞춰 비교
  const bench = vibe1 as unknown as Benchmark;
  const benchSum = summarizeBenchmark(bench);
  const cmp = buildCompare(bench, data, v.derived, v.planCurve);

  // ── 차트 배열 구성 ──
  const labels = v.planCurve.map((p) => shortDate(p.date));
  const planPerDay = v.planCurve.map((p) => p.perDay);
  const planCumSpend = v.planCurve.map((p) => p.cumSpend);
  const planSpendDaily = v.planCurve.map((p) => p.dailyBudget);
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
  const liveDates = data.goals.liveDates?.length ? data.goals.liveDates : [data.goals.webinarDate];
  const liveMarkers = liveDates
    .map((d, i) => ({ index: v.planCurve.findIndex((p) => p.date === d), label: `${i + 1}차 LIVE ${shortDate(d)}` }))
    .filter((m) => m.index >= 0);
  const liveLabel = liveDates.length > 1 ? `LIVE ${liveDates.map(shortDate).join("~")}` : `LIVE ${shortDate(liveDates[0])}`;
  // 실측이 한 줄도 없으면(집행 시작 전) 추이 차트는 계획선만 보여준다 — 배너로 먼저 알린다
  const hasActual = v.derived.some((d) => d.spend != null || d.dailyLeads != null);

  // 일별 CPA 추이 시리즈 (완결일 기준 3일 이동)
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
  const cpaBands = {
    green: data.goals.signalGreenMax,
    yellow: data.goals.signalYellowMax ?? 5500,
    freeze: data.goals.signalFreezeMax ?? 6200,
  };
  // CPA 신호 색상 (일별 테이블 셀용)
  const cpaClass = (cpa: number | null) =>
    cpa === null ? "" : cpa <= cpaBands.green ? "pos" : cpa <= cpaBands.yellow ? "" : cpa <= cpaBands.freeze ? "warn" : "neg";

  // 일별 지출 시리즈 + 차트 카드 헤더
  const spendDaily = v.planCurve.map((p) => dailyByDate.get(p.date)?.spend ?? null);
  const lastC = complete.length ? complete[complete.length - 1] : null;
  const chartHeaders = {
    daily: [num(v.latestActualDaily) + "명", `${lastC ? shortDate(lastC.date) : "—"} 실측 · 계획 ${num(v.todayRequired)}/일`] as [string, string],
    eff: [won(lastC?.spend ?? null), `일 CPA ${won(lastC?.cpaAdmin ?? null)} · 3일 ${won(v.rolling3Cpa)}`] as [string, string],
    cumSpend: [manwon(v.spendCum), `목표 ${manwon(v.planSpendToDate)} · ${pct(v.spendAchieveRate, 0)} 집행`] as [string, string],
    cumLeads: [num(v.leadsCum), `목표 ${num(data.goals.targetLeads)} · ${pct(v.goalProgress, 1)}`] as [string, string],
  };

  const s = v.signal;
  const history = computeSignalHistory(v.derived, data.goals, 7);

  // 세트별: 최신일 + 보유 기간 합산
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

  const leadsDelta = (v.leadsCum ?? 0) - (v.planLeadsToDate ?? 0);
  const spendDelta = (v.spendCum ?? 0) - (v.planSpendToDate ?? 0);
  const cpaDeltaPct = v.planCpaToDate ? ((v.cpaAdmin ?? 0) / v.planCpaToDate - 1) * 100 : null;
  const totalSpendAll = v.derived.reduce((s2, d) => s2 + (d.spend ?? 0), 0);
  void cpaDeltaPct;

  // 소재 요약 1줄 (테스트 소재는 캐시 조회 — 실패 시 링크만)
  const testing = await getTestingAdsCached(now).catch(() => null);
  let creativeSummary = "";
  if (testing?.items.length) {
    let settled = 0, learning = 0, risky = 0;
    for (const ad of testing.items) {
      if (ad.impressions < 500) { learning++; continue; }
      const cpa = ad.openEvents ? ad.spend / ad.openEvents : Infinity;
      if (cpa <= (data.goals.signalYellowMax ?? 5500)) settled++;
      else if (cpa > (data.goals.signalFreezeMax ?? 6200)) risky++;
    }
    creativeSummary = `🧪 테스트 ${testing.items.length}개 (✅${settled} · 🌱${learning} · 🔴${risky})`;
  }
  const topRunner = data.creatives?.items
    ?.filter((c) => c.status === "ACTIVE" && (c.cumulative?.openEvents ?? 0) > 0)
    .sort((a, b) => (b.cumulative?.openEvents ?? 0) - (a.cumulative?.openEvents ?? 0))[0];
  if (topRunner) creativeSummary += `${creativeSummary ? " · " : ""}🏆 ${topRunner.name}`;

  return (
    <>
      {/* 헤더·내비는 sticky 라 main(.wrap) 밖에 둔다 */}
      <header className="header">
        <div className="brand">
          <div className="logo">V2</div>
          <div>
            <h1>바이브코딩 2기 현황판</h1>
            <div className="sub">
              목표 {num(data.goals.targetLeads)}명 · LIVE {liveDates.map(shortDate).join(" · ")} ·{" "}
              {v.asOfDate ? `${v.asOfDate} 기준` : "집행 대기"}
            </div>
          </div>
        </div>
        <div className="header-right">
          <span className="chip mute" title={s.reason}>{DOT[s.level]} {won(v.rolling3Cpa)}</span>
          <ThemeToggle />
          <a className="btn-primary" href="/admin">입력 →</a>
        </div>
      </header>

      <SecNav
        items={[
          { id: "signal", label: "판단" },
          { id: "kpi", label: "KPI" },
          { id: "compare", label: "1기 비교" },
          { id: "revenue", label: "수익" },
          { id: "trend", label: "추이" },
          { id: "creatives", label: "소재" },
          { id: "adsets", label: "세트" },
          { id: "dailytable", label: "일별" },
        ]}
      />

      <main className="wrap">
      {v.cpaGapWarn && (
        <div className="banner warn" style={{ marginTop: 14 }}>
          어드민 CPA와 openEvent(픽셀) CPA 괴리 {pct(v.cpaGapPct, 1, { sign: true })} — 20%p 이상 벌어졌습니다. 트래킹/전환 반영 지연을 점검하세요.
        </div>
      )}

      {/* 1. 오늘의 판단 */}
      <div className="section" id="signal">
        <div className="eyebrow">오늘의 판단 <span className="desc">3일 이동 CPA 기준 증액 신호</span></div>
        <div className={`signal ${s.level}`}>
          <div className="dot">{DOT[s.level]}</div>
          <div className="body">
            <div className="t">
              {s.label}
              {s.stale && <span className="badge">갱신 필요</span>}
            </div>
            <div className="r">
              {s.reason}
              {s.rolling3Cpa != null && <> · 3일 이동 CPA {won(s.rolling3Cpa)}</>}
            </div>
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

      {/* 2. 누적 3카드 */}
      <div className="section">
        <div className="eyebrow">누적 <span className="desc">당일 누적 목표 대비</span></div>
        <div className="grid grid-3">
          <div className="card kpi">
            <div className="label">누적 알림신청</div>
            <div className="value">{num(v.leadsCum)} <span className="unit">/ {num(v.planLeadsToDate)}</span></div>
            <div className="foot">
              달성 {pct(v.leadsAchieveRate, 0)}
              <span className={`chip ${leadsDelta >= 0 ? "pos" : "neg"}`}>{num(leadsDelta, { sign: true })}명</span>
            </div>
            <div className="pbar"><i style={{ width: `${Math.min(100, v.leadsAchieveRate ?? 0)}%` }} /></div>
          </div>
          <div className="card kpi">
            <div className="label">누적 지출</div>
            <div className="value">{manwon(v.spendCum)} <span className="unit">/ {manwon(v.planSpendToDate)}</span></div>
            <div className="foot">
              집행 {pct(v.spendAchieveRate, 0)}
              <span className={`chip ${spendDelta <= 0 ? "pos" : "warn"}`}>{manwon(spendDelta)}</span>
            </div>
          </div>
          <div className="card kpi">
            <div className="label">누적 CPA</div>
            <div className="value">{won(v.cpaAdmin)}</div>
            <div className="foot">
              하드캡 {won(v.capToday)} 대비
              <span className={`chip ${(v.cpaHeadroom ?? 0) >= 0 ? "pos" : "neg"}`}>여유 {won(v.cpaHeadroom)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* 3. KPI 콤팩트 스트립 */}
      <div className="section" id="kpi">
        <div className="eyebrow">KPI</div>
        <div className="kpimini">
          <div className="card kpi">
            <div className="label">목표 진척</div>
            <div className="value sm">{num(v.leadsCum)} <span className="unit">/ {num(data.goals.targetLeads)}</span></div>
            <div className="foot"><span className="chip info">{pct(v.goalProgress, 1)}</span></div>
            <div className="pbar"><i style={{ width: `${Math.min(100, v.goalProgress ?? 0)}%` }} /></div>
          </div>
          <div className="card kpi">
            <div className="label">오늘 필요 인원 (플랜)</div>
            <div className="value sm">{num(v.todayRequired)}<span className="unit">/일</span></div>
            <div className="foot">
              최근 실측 {num(v.latestActualDaily)}
              <span className="chip mute">{pct(v.todayRequired && v.latestActualDaily != null ? (v.latestActualDaily / v.todayRequired) * 100 : null, 0)}</span>
            </div>
          </div>
          <div className="card kpi">
            <div className="label">잔여 필요 인원</div>
            <div className="value sm">{num(v.perDayNeeded)}<span className="unit">/일</span></div>
            <div className="foot">{num(v.remainingLeads)}건 ÷ {num(v.remainingDays)}일</div>
          </div>
          <div className="card kpi">
            <div className="label">잔여 예산</div>
            <div className="value sm">{money(v.remainingBudget)}</div>
            <div className="foot">총 {money(data.goals.totalBudget)}</div>
          </div>
          <div className="card kpi">
            <div className="label">최근 3일 CPA</div>
            <div className="value sm">{won(v.rolling3Cpa)}</div>
            <div className="foot">일 평균 {num(v.rolling3AvgLeads)}명</div>
          </div>
          <div className="card kpi">
            <div className="label">예상 착지</div>
            <div className="value sm">{num(v.projectedLanding)}<span className="unit">명</span></div>
            <div className="foot">잔여예산 ÷ 3일CPA + 누적</div>
          </div>
        </div>
      </div>

      {/* 4. CPA 이중 표기 */}
      <div className="section">
        <div className="eyebrow">CPA 이중 표기 <span className="desc">전체 알림(어드민) vs openEvent(픽셀)</span></div>
        <div className="card dualcard">
          <div className="dual">
            <div>
              <div className="col-label">전체 알림 기준 · 어드민</div>
              <div className="big">{won(v.cpaAdmin)}</div>
              <div className="sub">누적 알림 {num(v.leadsCum)}명</div>
              <div style={{ marginTop: 10 }}>
                <span className={`chip ${v.cpaGapWarn ? "warn" : "mute"}`}>괴리율 {pct(v.cpaGapPct, 1, { sign: true })}</span>
                {v.cpaGapWarn && <span className="warn" style={{ fontSize: 11.5, marginLeft: 6 }}>20%p 이상 — 트래킹 점검 필요</span>}
              </div>
            </div>
            <div>
              <div className="col-label">openEvent 기준 · 픽셀</div>
              <div className="small">{won(v.cpaOpenEvent)}</div>
              <div className="sub">누적 openEvent {num(v.openEventsCum)}건</div>
            </div>
          </div>
        </div>
      </div>

      {/* 4.5 1기 대비 비교 */}
      <CompareSection
        bench={bench}
        sum={benchSum}
        cmp={cmp}
        targetLeads={data.goals.targetLeads}
        targetCpa={data.goals.targetCpa ?? Math.round(data.goals.totalBudget / data.goals.targetLeads)}
        totalBudget={data.goals.totalBudget}
        liveDates={liveDates}
        capCpa={data.goals.signalFreezeMax ?? 6200}
      />

      {/* 5. 기대수익 3단 */}
      <div className="section" id="revenue">
        <div className="eyebrow">
          기대수익{" "}
          <span className="desc">
            객단가 {manwon(data.goals.aov)}원 · 전환율 계획 {pct((data.goals.planConversion ?? data.goals.conversionBand.low) * 100, 1)} ~ 1기 실적{" "}
            {pct(data.goals.conversionBand.high * 100, 2)}
          </span>
        </div>
        <div className="grid grid-3">
          <div className="card rev">
            <div className="rlabel">현재 확보분</div>
            <div className="n">{eok(v.bandCurrent?.revLow)} ~ {eok(v.bandCurrent?.revHigh)}</div>
            <div className="band">{num(v.bandCurrent?.leadsLow)}~{num(v.bandCurrent?.leadsHigh)}건 · {num(v.leadsCum)}명</div>
            <span className="corner">확정</span>
          </div>
          <div className="card rev">
            <div className="rlabel">예상 착지</div>
            <div className="n">{eok(v.bandLanding?.revLow)} ~ {eok(v.bandLanding?.revHigh)}</div>
            <div className="band">{num(v.bandLanding?.leadsLow)}~{num(v.bandLanding?.leadsHigh)}건 · {num(v.projectedLanding)}명</div>
          </div>
          <div className="card rev">
            <div className="rlabel">목표 {num(data.goals.stretchLeads ?? data.goals.targetLeads)}명 달성 시</div>
            <div className="n">{eok(v.bandTarget.revLow)} ~ {eok(v.bandTarget.revHigh)}</div>
            <div className="band">
              {num(v.bandTarget.leadsLow)}~{num(v.bandTarget.leadsHigh)}건 · 계획 기준 {eok(v.bandTarget.revLow)}
            </div>
            <span className="corner goal">목표</span>
          </div>
        </div>
      </div>

      {/* 6. 차트 */}
      <div className="section" id="trend">
        <div className="eyebrow">추이 <span className="desc">실측 vs 목표</span></div>
        {!hasActual && (
          <div className="banner info" style={{ marginBottom: 12 }}>
            아직 실측이 없습니다 — 아래 차트는 <b>계획선만</b> 표시됩니다. {shortDate(data.goals.startDate)} 집행분부터 메타 API 로 자동 수집됩니다.
          </div>
        )}
        <Charts
          labels={labels}
          planPerDay={planPerDay}
          actualDaily={actualDaily}
          planCumSpend={planCumSpend}
          actualCumSpend={actualCumSpend}
          planCumLeads={planCumLeads}
          actualCumLeads={actualCumLeads}
          liveMarkers={liveMarkers}
          liveLabel={liveLabel}
          planSpendDaily={planSpendDaily}
          spendDaily={spendDaily}
          cpaDaily={cpaDaily}
          cpaRolling={cpaRolling}
          cpaBands={cpaBands}
          headers={chartHeaders}
        />
      </div>

      {/* 6.5 소재 TOP5 (전체누적/실시간 토글) + 상세 링크 */}
      {data.creatives && data.creatives.items.length > 0 && (
        <CreativeSection block={data.creatives} compact capCpa={data.goals.signalFreezeMax ?? 6200} />
      )}
      <div className="section" style={{ marginTop: 12 }}>
        <a href="/creatives" className="card testline">
          <span>🎨 소재 전체 보기{creativeSummary && <span className="tsum"> · {creativeSummary}</span>}</span>
          <span className="tarrow">→</span>
        </a>
      </div>

      {/* 7. 세트별 (최신일/합산 토글) */}
      <AdsetSection
        latest={adsetLatest}
        latestDate={v.latestAdsetDate}
        agg={[...aggMap.values()]}
        aggFrom={adsetDates[0] ?? null}
        aggTo={adsetDates[adsetDates.length - 1] ?? null}
        capCpa={data.goals.signalFreezeMax ?? 6200}
        mainCampaignId={data.meta.campaignIds[0] ?? null}
      />

      {/* 8. 확정 곡선 (일별 플랜) */}
      <div className="section">
        <div className="eyebrow">
          주차별 플랜{" "}
          <span className="desc">
            {data.planDaily?.length ? "일별 확정 플랜" : "주차별 계단 증액 · 합계 " + num(data.goals.targetLeads) + "명 / " + money(data.goals.totalBudget) + " / 블렌디드 CPA " + won(data.goals.targetCpa ?? null)}
          </span>
        </div>
        <div className="card table-scroll">
          <table>
            <thead>
              <tr><th>구간</th><th>일수</th><th>필요/일</th><th>일예산</th><th>목표 CPA</th><th>구간 알림</th><th>구간 예산</th></tr>
            </thead>
            <tbody>
              {(data.planDaily?.length
                ? data.planDaily.map((p) => ({ key: p.date, label: shortDate(p.date), days: 1, perDay: p.planLeads, budget: p.planSpend, cpa: p.planCpa }))
                : data.plan.map((p, i) => ({ key: String(i), label: `${i + 1}주 ${shortDate(p.from)}~${shortDate(p.to)}`, days: p.days, perDay: p.perDay, budget: p.dailyBudget, cpa: p.targetCpa }))
              ).map((r) => (
                <tr key={r.key}>
                  <td>{r.label}</td>
                  <td className="mono">{r.days}일</td>
                  <td className="mono">{num(r.perDay)}</td>
                  <td className="mono">{manwon(r.budget)}</td>
                  <td className="mono">{won(r.cpa)}</td>
                  <td className="mono">{num(r.perDay * r.days)}</td>
                  <td className="mono">{manwon(r.budget * r.days)}</td>
                </tr>
              ))}
              <tr className="total">
                <td>합계</td>
                <td className="mono">{data.plan.reduce((a, p) => a + p.days, 0)}일</td>
                <td className="mono">—</td>
                <td className="mono">—</td>
                <td className="mono">{won(data.goals.targetCpa ?? null)}</td>
                <td className="mono">{num(data.plan.reduce((a, p) => a + p.perDay * p.days, 0))}</td>
                <td className="mono">{money(data.plan.reduce((a, p) => a + p.dailyBudget * p.days, 0))}</td>
              </tr>
            </tbody>
          </table>
        </div>
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
                  <td className={`mono ${cpaClass(d.cpaAdmin)}`} style={{ fontWeight: 700 }}>{won(d.cpaAdmin)}</td>
                  <td className="mono">{pct(d.ctr, 2)}</td>
                  <td className="mono">{won(d.cpm)}</td>
                  <td className="mono">{d.frequency ?? "—"}</td>
                </tr>
              ))}
              <tr className="total">
                <td>누적</td>
                <td className="mono">{won(totalSpendAll)}</td>
                <td className="mono">{num(v.leadsCum)}</td>
                <td className="mono">{num(v.derived.reduce((s2, d) => s2 + (d.openEvents ?? 0), 0))}</td>
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
        최종 갱신 {new Date(Date.parse(data.meta.lastUpdated)).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} · <a href="/admin">데이터 입력</a>
      </div>
      </main>
    </>
  );
}
