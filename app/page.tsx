import { getDataset } from "@/lib/dataStore";
import { computeView, computeSignalHistory, dayIndex, planForDate, todayKST, diffDays } from "@/lib/metrics";
import { won, num, pct, money, eok, shortDate } from "@/lib/format";
import HomeCharts from "@/components/HomeCharts";
import { getTestingAdsCached } from "@/lib/meta";
import AdsetSection, { type AdsetRow } from "@/components/AdsetSection";
import ThemeToggle from "@/components/ThemeToggle";
import SecNav from "@/components/SecNav";

const DOT: Record<string, string> = { green: "🟢", yellow: "🟡", freeze: "🟠", red: "🔴", gray: "⚪" };

export const dynamic = "force-dynamic";

// 계산식·출처는 본문에서 빼고 ⓘ 툴팁으로 (텍스트 다이어트 규칙)
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

  const liveDates = g.liveDates?.length ? g.liveDates : [g.webinarDate];
  const liveIdx = liveDates.map((d) => v.planCurve.findIndex((p) => p.date === d)).filter((i) => i >= 0);
  const liveLabel = `LIVE ${liveDates.map(shortDate).join("~")}`;
  const today = todayKST(now);
  const dDay = diffDays(today, liveDates[0]); // LIVE 까지 남은 일수

  const hasActual = v.derived.some((d) => d.spend != null || d.dailyLeads != null);
  const hasLeads = v.leadsCum !== null;

  // 일 CPA 3일 이동 시리즈
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
  // 홈은 TOP3 만 — 전체 표는 아래 세트 섹션(토글)에 그대로 둔다
  const top3 = [...aggMap.values()]
    .map((a) => ({ ...a, cpa: a.openEvents ? a.spend / a.openEvents : null }))
    .sort((a, b) => b.openEvents - a.openEvents || (a.cpa ?? Infinity) - (b.cpa ?? Infinity))
    .slice(0, 3);

  const leadsDelta = (v.leadsCum ?? 0) - (v.planLeadsToDate ?? 0);
  const spendDelta = (v.spendCum ?? 0) - (v.planSpendToDate ?? 0);
  const totalSpendAll = v.derived.reduce((s2, d) => s2 + (d.spend ?? 0), 0);

  // ── 소재 요약 뱃지 ──
  const testing = await getTestingAdsCached(now).catch(() => null);
  let creativeSummary = "";
  if (testing?.items.length) {
    let settled = 0, learning = 0, risky = 0;
    for (const ad of testing.items) {
      if (ad.impressions < 500) { learning++; continue; }
      const cpa = ad.openEvents ? ad.spend / ad.openEvents : Infinity;
      if (cpa <= (g.signalYellowMax ?? 5500)) settled++;
      else if (cpa > capCpa) risky++;
    }
    creativeSummary = `🧪 테스트 ${testing.items.length}개 (✅${settled} · 🌱${learning} · 🔴${risky})`;
  }

  // ── 현재 주차 ──
  const curStep = data.plan.find((p) => diffDays(p.from, today) >= 0 && diffDays(today, p.to) >= 0) ?? data.plan[0];
  const curStepNo = data.plan.indexOf(curStep) + 1;
  const todayPlan = planForDate(data, today);

  const revLow = g.targetLeads * g.conversionBand.low * g.aov;
  const revHigh = g.targetLeads * g.conversionBand.high * g.aov;

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
          { id: "kpi", label: "지표" },
          { id: "trend", label: "추이" },
          { id: "adsets", label: "세트" },
          { id: "plan", label: "플랜" },
          { id: "dailytable", label: "일별" },
        ]}
      />

      <main className="wrap">
        {/* 1. 오늘의 판단 — 뱃지 + 한 줄 */}
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

        {/* 2. 빅넘버 — 값이 없는 카드는 접고, 남은 개수에 맞춰 열을 잡는다 */}
        <div className="section" id="kpi">
          <div className={`grid grid-${2 + (hasLeads ? 1 : 0) + (v.projectedLanding !== null ? 1 : 0)}`}>
            <div className="card kpi">
              <div className="label">누적 알림신청</div>
              <div className="value">{hasLeads ? num(v.leadsCum) : "—"}</div>
              <div className="foot">
                / {num(g.targetLeads)}
                {hasLeads ? (
                  <span className="chip info">{pct(v.goalProgress, 1)}</span>
                ) : (
                  <span className="chip mute">⚪ 수집 중</span>
                )}
              </div>
              <div className="pbar"><i style={{ width: `${Math.min(100, v.goalProgress ?? 0)}%` }} /></div>
            </div>

            <div className="card kpi">
              <div className="label">누적 지출</div>
              <div className="value">{money(totalSpendAll)}</div>
              <div className="foot">
                / {money(g.totalBudget)}
                <span className="chip mute">{pct((totalSpendAll / g.totalBudget) * 100, 1)}</span>
              </div>
              <div className="pbar"><i style={{ width: `${Math.min(100, (totalSpendAll / g.totalBudget) * 100)}%` }} /></div>
            </div>

            {hasLeads && (
              <div className="card kpi">
                <div className="label">
                  누적 CPA <Tip text={`누적 지출 ÷ 누적 알림신청. 하드캡 ${won(v.capToday)} · 목표 ${won(g.targetCpa ?? null)}`} />
                </div>
                <div className="value">{won(v.cpaAdmin)}</div>
                <div className="foot">
                  <span className={`chip ${(v.cpaHeadroom ?? 0) >= 0 ? "pos" : "neg"}`}>
                    여유 {pct(((v.cpaHeadroom ?? 0) / v.capToday) * 100, 0, { sign: true })}
                  </span>
                  {v.cpaGapPct !== null && (
                    <span className={`chip ${v.cpaGapWarn ? "warn" : "mute"}`} title="어드민 알림신청 기준 CPA와 픽셀(openEvent) 기준 CPA의 차이">
                      픽셀 괴리 {pct(v.cpaGapPct, 0, { sign: true })}
                    </span>
                  )}
                </div>
              </div>
            )}

            {v.projectedLanding !== null && (
              <div className="card kpi">
                <div className="label">
                  예상 착지 <Tip text="잔여 예산 ÷ 최근 3일 CPA + 현재 누적" />
                </div>
                <div className="value">{num(v.projectedLanding)}</div>
                <div className="foot">
                  <span className={`chip ${v.projectedLanding >= g.targetLeads ? "pos" : "neg"}`}>
                    목표 대비 {pct((v.projectedLanding / g.targetLeads) * 100, 0)}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* 3. 페이스 한 줄 */}
          <div className="card paceline">
            <div>
              <span className="pl">오늘 필요</span>
              <b>{num(v.todayRequired)}</b>
              <span className="pu">/일</span>
            </div>
            {v.latestActualDaily !== null && (
              <div>
                <span className="pl">최근 실측</span>
                <b>{num(v.latestActualDaily)}</b>
                <span className="pu">/일</span>
              </div>
            )}
            {v.perDayNeeded !== null && (
              <div>
                <span className="pl">잔여 필요</span>
                <b>{num(v.perDayNeeded)}</b>
                <span className="pu">/일</span>
              </div>
            )}
            {hasLeads && (
              <>
                <span className={`chip ${leadsDelta >= 0 ? "pos" : "neg"}`}>계획 대비 {num(leadsDelta, { sign: true })}명</span>
                <span className={`chip ${spendDelta <= 0 ? "pos" : "warn"}`}>
                  지출 {spendDelta > 0 ? "+" : ""}{money(spendDelta)}
                </span>
              </>
            )}
          </div>
        </div>

        {/* 4. 차트 2개 */}
        <div className="section" id="trend">
          {!hasActual && (
            <div className="banner info" style={{ marginBottom: 12 }}>
              실측 대기 — {shortDate(g.startDate)} 집행분부터 자동 수집됩니다. 아래는 계획선입니다.
            </div>
          )}
          <HomeCharts
            labels={labels}
            planCumLeads={planCumLeads}
            actualCumLeads={actualCumLeads}
            planPerDay={planPerDay}
            actualDaily={actualDaily}
            planCumSpend={planCumSpend}
            actualCumSpend={actualCumSpend}
            cpaDaily={cpaDaily}
            cpaRolling={cpaRolling}
            capCpa={capCpa}
            targetCpa={g.targetCpa ?? Math.round(g.totalBudget / g.targetLeads)}
            liveFrom={liveIdx.length ? liveIdx[0] : -1}
            liveTo={liveIdx.length ? liveIdx[liveIdx.length - 1] : -1}
            liveLabel={liveLabel}
            hasActual={hasActual}
          />
        </div>

        {/* 5. 기대수익 한 줄 */}
        <div className="section" id="revenue">
          <div className="card oneline">
            <span className="ol-label">기대수익</span>
            <span className="ol-main">
              목표 {num(g.targetLeads)}명 달성 시 <b>{eok(revLow)} ~ {eok(revHigh)}</b>
            </span>
            <span className="chip mute">
              전환율 {pct(g.conversionBand.low * 100, 1)}~{pct(g.conversionBand.high * 100, 2)}
            </span>
            <Tip text={`객단가 ${money(g.aov)}원 기준. 하한 = 계획 전환율 ${pct(g.conversionBand.low * 100, 1)}, 상한 = 1기 실적 전환율 ${pct(g.conversionBand.high * 100, 2)}`} />
            {hasLeads && v.bandCurrent && (
              <span className="chip info">현재 확보 {eok(v.bandCurrent.revLow)} ~ {eok(v.bandCurrent.revHigh)}</span>
            )}
            {v.bandLanding && (
              <span className="chip">착지 {eok(v.bandLanding.revLow)} ~ {eok(v.bandLanding.revHigh)}</span>
            )}
          </div>
        </div>

        {/* 6. 세트 TOP3 + 소재 요약 */}
        {top3.length > 0 && (
          <div className="section" id="adsets">
            <div className="eyebrow">세트 TOP3 <span className="desc">전환수 순 · CPA {capCpa.toLocaleString("ko-KR")} 초과 빨강</span></div>
            <div className="card toplist">
              {top3.map((a, i) => (
                <div key={a.adsetId} className="toprow">
                  <span className="rk">{["🥇", "🥈", "🥉"][i]}</span>
                  <span className="nm">{a.name}</span>
                  <span className="mono">{won(a.spend)}</span>
                  <span className="mono">{num(a.openEvents)}</span>
                  <span className={`mono ${(a.cpa ?? 0) > capCpa ? "neg" : ""}`} style={{ fontWeight: 700 }}>{won(a.cpa)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="section" id="creatives">
          <a href="/creatives" className="card testline">
            <span>{creativeSummary || "🎨 소재 전체 보기"}</span>
            <span className="tarrow">→</span>
          </a>
        </div>

        {/* 7. 세트 전체 — 홈에는 접어두고 필요할 때만 편다 */}
        {adsetLatest.length > 0 && (
          <div className="section">
            <details>
              <summary>세트 전체 보기</summary>
              <AdsetSection
                latest={adsetLatest}
                latestDate={v.latestAdsetDate}
                agg={[...aggMap.values()]}
                aggFrom={adsetDates[0] ?? null}
                aggTo={adsetDates[adsetDates.length - 1] ?? null}
                capCpa={capCpa}
                mainCampaignId={data.meta.campaignIds[0] ?? null}
              />
            </details>
          </div>
        )}

        {/* 8. 현재 주차 1줄 + 전체 플랜 아코디언 */}
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
        {hasActual && (
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
        )}

        <div className="footer-links">
          최종 갱신 {new Date(Date.parse(data.meta.lastUpdated)).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} ·{" "}
          <a href="/admin">데이터 입력</a> · <a href="/gen1">1기 아카이브 보기</a>
        </div>
      </main>
    </>
  );
}
