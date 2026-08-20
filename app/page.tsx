import { getDataset } from "@/lib/dataStore";
import { computeView, computeSignalHistory, dayIndex, planForDate, todayKST, diffDays } from "@/lib/metrics";
import { won, num, pct, money, eok, shortDate } from "@/lib/format";
import HomeCharts from "@/components/HomeCharts";
import { getTestingAdsCached } from "@/lib/meta";
import AdsetSection, { type AdsetRow } from "@/components/AdsetSection";
import CreativeSection from "@/components/CreativeSection";
import ThemeToggle from "@/components/ThemeToggle";
import SecNav from "@/components/SecNav";

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
  const capCpa = g.signalFreezeMax ?? 6200;
  const cpaClass = (cpa: number | null) =>
    cpa === null ? "" : cpa <= g.signalGreenMax ? "pos" : cpa <= (g.signalYellowMax ?? 5500) ? "" : cpa <= capCpa ? "warn" : "neg";

  const s = v.signal;
  const history = computeSignalHistory(v.derived, g, 7);

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

  // ── 기대수익 시나리오 (1차 웨비나 2.5~3.5% / 최종 5.0%) ──
  const rc = g.revConv ?? { w1Low: 0.025, w1High: 0.035, final: 0.05 };
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
      if (cpa <= (g.signalYellowMax ?? 5500)) settled++;
      else if (cpa > capCpa) risky++;
    }
    testLine = `🧪 테스트 ${testing.items.length}개 진행 중 (✅ 승자 ${settled} · 🌱 육성 ${learning} · 🔴 종료 ${risky})`;
  }

  // ── 현재 주차 ──
  const curStep = data.plan.find((p) => diffDays(p.from, today) >= 0 && diffDays(today, p.to) >= 0) ?? data.plan[0];
  const curStepNo = data.plan.indexOf(curStep) + 1;
  const todayPlan = planForDate(data, today);

  // KPI 행 카드 수 (값 없는 카드는 접고 열 수 자동 조정)
  const kpiCols = 2 + (lastC ? 1 : 0) + (v.projectedLanding !== null ? 1 : 0);

  return (
    <>
      <header className="header">
        <div className="brand">
          <div className="logo">V2</div>
          <div>
            <h1>바이브코딩 2기 현황판</h1>
            <div className="sub">
              목표 {num(g.targetLeads)}명 · LIVE {liveDates.map(shortDate).join("·")}
              {dDay > 0 ? ` · D-${dDay}` : dDay === 0 ? " · D-DAY" : ""}
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
        {/* 1. 오늘의 판단 — 신호등 + 7일 히스토리 */}
        <div className="section" id="signal">
          <div className={`signal ${s.level}`}>
            <div className="dot">{DOT[s.level]}</div>
            <div className="body">
              <div className="t">
                {s.rolling3Cpa === null ? "데이터 수집 중" : s.label}
                {s.stale && <span className="badge">갱신 필요</span>}
              </div>
              <div className="r">
                {s.rolling3Cpa === null
                  ? `${shortDate(g.startDate)} 집행 시작 · 알림신청 입력 대기`
                  : `3일 이동 CPA ${won(s.rolling3Cpa)} · 하드캡 ${won(v.capToday)}`}
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
                <div className={`value ${cpaClass(lastC.cpaAdmin)}`}>{won(lastC.cpaAdmin)}</div>
                <div className="foot">
                  3일 이동 {won(v.rolling3Cpa)}
                  <span className="chip mute">{shortDate(lastC.date)}</span>
                </div>
              </div>
            )}

            {v.projectedLanding !== null && (
              <div className="card kpi">
                <div className="label">
                  예상 착지 <Tip text="잔여 예산 ÷ 최근 3일 CPA + 현재 누적" />
                </div>
                <div className="value">{num(v.projectedLanding)}<span className="unit">명</span></div>
                <div className="foot">
                  <span className={`chip ${v.projectedLanding >= g.targetLeads ? "pos" : "neg"}`}>
                    목표 대비 {pct((v.projectedLanding / g.targetLeads) * 100, 0)}
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
              객단가 {money(g.aov)}원 · 1차 {pct(rc.w1Low * 100, 1)}~{pct(rc.w1High * 100, 1)} / 최종 {pct(rc.final * 100, 1)}
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
              <div className="rlabel">최종 (2차 + 이후)</div>
              <div className="n">{eok(revBase * rc.final * g.aov)}</div>
              <div className="band">{num(revBase * rc.final)}건 · {revBaseLabel}</div>
              <span className="corner goal">{pct(rc.final * 100, 1)}</span>
            </div>
            {v.projectedLanding !== null ? (
              <div className="card rev">
                <div className="rlabel">예상 착지 기준</div>
                <div className="n">{eok(v.projectedLanding * rc.final * g.aov)}</div>
                <div className="band">{num(v.projectedLanding * rc.final)}건 · 착지 {num(v.projectedLanding)}명</div>
                <span className="corner goal">{pct(rc.final * 100, 1)}</span>
              </div>
            ) : (
              <div className="card rev">
                <div className="rlabel">예상 착지 기준</div>
                <div className="n">—</div>
                <div className="band"><span className="chip mute">⚪ 수집 중</span></div>
                <span className="corner goal">{pct(rc.final * 100, 1)}</span>
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
            zoneGreenMax={g.signalGreenMax}
            zoneYellowMax={g.cpaHardCap}
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
            <span className="ol-label">{curStepNo}주차</span>
            <span className="ol-main">
              {shortDate(curStep.from)}~{shortDate(curStep.to)} · <b>{num(todayPlan?.perDay ?? curStep.perDay)}명/일</b> · 일예산{" "}
              {money(todayPlan?.dailyBudget ?? curStep.dailyBudget)} · 목표 CPA {won(todayPlan?.targetCpa ?? curStep.targetCpa)}
            </span>
          </div>
          <details style={{ marginTop: 8 }}>
            <summary>전체 플랜 보기</summary>
            <div className="card table-scroll" style={{ marginTop: 8 }}>
              <table>
                <thead>
                  <tr><th>구간</th><th>일수</th><th>필요/일</th><th>일예산</th><th>목표 CPA</th><th>구간 알림</th><th>구간 예산</th></tr>
                </thead>
                <tbody>
                  {data.plan.map((p, i) => (
                    <tr key={p.from} className={p === curStep ? "total" : ""}>
                      <td>{i + 1}주 {shortDate(p.from)}~{shortDate(p.to)}</td>
                      <td className="mono">{p.days}일</td>
                      <td className="mono">{num(p.perDay)}</td>
                      <td className="mono">{money(p.dailyBudget)}</td>
                      <td className="mono">{won(p.targetCpa)}</td>
                      <td className="mono">{num(p.perDay * p.days)}</td>
                      <td className="mono">{money(p.dailyBudget * p.days)}</td>
                    </tr>
                  ))}
                  <tr className="total">
                    <td>합계</td>
                    <td className="mono">{data.plan.reduce((a, p) => a + p.days, 0)}일</td>
                    <td className="mono">—</td>
                    <td className="mono">—</td>
                    <td className="mono">{won(g.targetCpa ?? null)}</td>
                    <td className="mono">{num(data.plan.reduce((a, p) => a + p.perDay * p.days, 0))}</td>
                    <td className="mono">{money(data.plan.reduce((a, p) => a + p.dailyBudget * p.days, 0))}</td>
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
                    <td className={`mono ${cpaClass(d.cpaAdmin)}`} style={{ fontWeight: 700 }}>{won(d.cpaAdmin)}</td>
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
