// 1기 vs 2기 비교 섹션 (서버 컴포넌트). 차트만 클라이언트로 넘긴다.

import { won, num, pct, manwon, eok, money } from "@/lib/format";
import type { Benchmark, BenchSummary, CompareView } from "@/lib/benchmark";
import CompareCharts from "./CompareCharts";

interface Props {
  bench: Benchmark;
  sum: BenchSummary;
  cmp: CompareView;
  targetLeads: number;
  targetCpa: number;
  totalBudget: number;
  liveDates: string[];
  capCpa: number;
}

const md = (iso: string) => `${parseInt(iso.slice(5, 7), 10)}/${parseInt(iso.slice(8, 10), 10)}`;

export default function CompareSection({ bench, sum, cmp, targetLeads, targetCpa, totalBudget, liveDates, capCpa }: Props) {
  const cpaDelta = ((targetCpa - sum.cpa) / sum.cpa) * 100;
  const t = cmp.today;

  return (
    <div className="section" id="compare">
      <div className="eyebrow">
        1기 대비 <span className="desc">1차 LIVE 를 D-DAY 로 맞춘 동일 시점 비교 · 1기 {md(bench.meta.trackedFrom)}~{md(bench.meta.trackedTo)} 확정 실적</span>
      </div>

      {/* 목표 스케일 3카드 */}
      <div className="grid grid-3">
        <div className="card kpi">
          <div className="label">알림신청 목표 배수</div>
          <div className="value">×{cmp.scale.toFixed(2)}</div>
          <div className="foot">
            1기 {num(sum.leads)}명 → 2기 {num(targetLeads)}명
            <span className="chip info">+{num(targetLeads - sum.leads)}</span>
          </div>
        </div>
        <div className="card kpi">
          <div className="label">광고예산 배수</div>
          <div className="value">×{cmp.budgetScale.toFixed(2)}</div>
          <div className="foot">
            1기 {money(sum.spend)} → 2기 {money(totalBudget)}
          </div>
        </div>
        <div className="card kpi">
          <div className="label">목표 CPA vs 1기 실적</div>
          <div className="value">{won(targetCpa)}</div>
          <div className="foot">
            1기 실적 {won(sum.cpa)}
            <span className={`chip ${cpaDelta <= 0 ? "pos" : "neg"}`}>{pct(cpaDelta, 1, { sign: true })}</span>
          </div>
        </div>
      </div>

      {/* 동일 D-day 시점 비교 */}
      <div className="card" style={{ marginTop: 12 }}>
        {t.d === null ? (
          <div className="foot">
            2기 실측이 아직 없습니다. 첫 알림신청이 입력되면 같은 D-day 의 1기 누적과 자동으로 비교됩니다.
            <br />
            2기 1차 LIVE {liveDates[0] ? md(liveDates[0]) : "—"} = D-DAY · 1기 1차 LIVE {md(sum.live1)} 와 같은 자리.
          </div>
        ) : (
          <>
            <div className="dual">
              <div>
                <div className="col-label">
                  2기 · {t.date2 ? md(t.date2) : "—"} ({cmp.points.find((p) => p.d === t.d)?.label})
                </div>
                <div className="big">{num(t.cum2)}명</div>
                <div className="sub">일 CPA {won(t.cpa2)}</div>
              </div>
              <div>
                <div className="col-label">1기 · 같은 D-day</div>
                <div className="small">{num(t.cum1AtSameD)}명</div>
                <div className="sub">{t.bench1Live ? `일 CPA ${won(t.cpa1AtSameD)}` : `1기는 ${cmp.points.find((p) => p.bench1Live)?.label ?? "—"} 부터 집행`}</div>
              </div>
            </div>
            <div className="foot" style={{ marginTop: 12 }}>
              {t.bench1Live ? (
                <>
                  <span className={`chip ${(t.ratio ?? 0) >= 1 ? "pos" : "warn"}`}>1기 대비 ×{t.ratio?.toFixed(2) ?? "—"}</span>
                  <span className={`chip ${(t.pace ?? 0) >= 1 ? "pos" : "neg"}`}>
                    {num(targetLeads)} 페이스 {pct((t.pace ?? 0) * 100, 0)}
                  </span>
                </>
              ) : (
                <span className="chip pos">1기 미집행 구간 — 2기가 {t.leadDays}일 선행</span>
              )}
              <span className="chip mute">{num(targetLeads)} 달성엔 1기 대비 ×{cmp.scale.toFixed(2)} 필요</span>
            </div>
          </>
        )}
      </div>

      {/* 1기 확정 실적 팩트 */}
      <div className="eyebrow" style={{ marginTop: 18 }}>
        1기 확정 실적 <span className="desc">{bench.meta.campaignName}</span>
      </div>
      <div className="kpimini">
        <div className="card kpi">
          <div className="label">알림신청</div>
          <div className="value sm">{num(sum.leads)}<span className="unit">명</span></div>
          <div className="foot">목표 {num(bench.goals.targetLeads)} · {pct((sum.leads / bench.goals.targetLeads) * 100, 1)}</div>
        </div>
        <div className="card kpi">
          <div className="label">광고비 / CPA</div>
          <div className="value sm">{money(sum.spend)}</div>
          <div className="foot">CPA {won(sum.cpa)} · {sum.days}일 집행</div>
        </div>
        <div className="card kpi">
          <div className="label">노출 / CTR</div>
          <div className="value sm">{num(sum.impressions / 10000)}<span className="unit">만</span></div>
          <div className="foot">CTR {pct(sum.ctr, 2)} · CPC {won(sum.cpc)}</div>
        </div>
        <div className="card kpi">
          <div className="label">판매</div>
          <div className="value sm">{num(sum.sales)}<span className="unit">건</span></div>
          <div className="foot">구매전환 {pct(sum.buyRate, 2)} · 객단가 {manwon(sum.aov)}</div>
        </div>
        <div className="card kpi">
          <div className="label">매출</div>
          <div className="value sm">{eok(sum.revenue)}</div>
          <div className="foot">ROAS {pct(sum.roas, 0)} (전체 광고비 기준)</div>
        </div>
        <div className="card kpi">
          <div className="label">최다 신청일</div>
          <div className="value sm">{num(sum.peakLeads.leads)}<span className="unit">명</span></div>
          <div className="foot">{md(sum.peakLeads.date)} · 최대 지출 {manwon(sum.peakSpend.spend)} ({md(sum.peakSpend.date)})</div>
        </div>
      </div>

      {/* 1기 LIVE 세션 성과 */}
      <div className="eyebrow" style={{ marginTop: 18 }}>
        1기 LIVE 성과 <span className="desc">2기 LIVE({liveDates.map(md).join(" · ")}) 운영 목표 기준선</span>
      </div>
      <div className="grid grid-2">
        {bench.liveSessions.map((s) => (
          <div key={s.date} className="card kpi">
            <div className="label">
              {s.label} · {md(s.date)}
            </div>
            <div className="value sm">
              {num(s.sales)}<span className="unit">건</span> · {eok(s.revenue)}
            </div>
            <div className="foot">
              단톡방 {num(s.openChat)} · 오픈알림 {num(s.openAlert)} → 시청 {num(s.viewers)}
              <span className="chip mute">시청률 {pct(s.viewerRate * 100, 1)}</span>
              <span className="chip info">구매전환 {pct(s.buyRate * 100, 1)}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="card" style={{ marginTop: 12 }}>
        <div className="foot">
          {Object.values(bench.salesSplit).map((s) => (
            <span key={s.label} className="chip mute">
              {s.label} {num(s.sales)}건 · {eok(s.revenue)} ({pct(s.revenueShare * 100, 1)})
            </span>
          ))}
          {bench.products.map((p) => (
            <span key={p.type} className="chip" title={p.note}>
              {p.type} {p.priceLabel} · {num(p.sales)}건 ({pct(p.share * 100, 1)})
            </span>
          ))}
        </div>
      </div>

      {/* 비교 차트 */}
      <div className="eyebrow" style={{ marginTop: 18 }}>
        D-day 정렬 차트{" "}
        <span className="desc">
          1차 LIVE = D-DAY · 2기 캠페인 구간({cmp.points[0]?.label}~{cmp.points[cmp.points.length - 1]?.label})만 표시
        </span>
      </div>
      <CompareCharts
        points={cmp.points.map((p) => ({
          d: p.d,
          label: p.label,
          date1: p.date1,
          date2: p.date2,
          leads1: p.leads1,
          leads2: p.leads2,
          cum1: p.cum1,
          cum2: p.cum2,
          bench1Live: p.bench1Live,
          cpa1: p.cpa1,
          cpa2: p.cpa2,
          cumSpend1: p.cumSpend1,
          cumSpend2: p.cumSpend2,
          planCum2: p.planCum2,
        }))}
        scale={cmp.scale}
        liveBand={cmp.liveBand}
        targetLeads={targetLeads}
        bench1Total={sum.leads}
        bench1Spend={sum.spend}
        totalBudget={totalBudget}
        capCpa={capCpa}
      />

      {/* 1기 일별 원표 */}
      <details style={{ marginTop: 12 }}>
        <summary style={{ cursor: "pointer", fontSize: 12.5, color: "hsl(var(--text-3))", padding: "6px 2px" }}>
          1기 일별 실측 전체 보기 ({bench.daily.length}일)
        </summary>
        <div className="card table-scroll" style={{ marginTop: 8 }}>
          <table>
            <thead>
              <tr>
                <th>날짜</th><th>D-day</th><th>알림</th><th>누적</th><th>지출</th><th>노출</th><th>클릭</th><th>CTR</th><th>CPA</th><th>판매</th><th>매출</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                let cum = 0;
                return bench.daily.map((r) => {
                  cum += r.leads;
                  const ddLabel = cmp.labelByDate1[r.date];
                  return (
                    <tr key={r.date}>
                      <td>{md(r.date)}</td>
                      <td className="mono">{ddLabel ?? "—"}</td>
                      <td className="mono">{num(r.leads)}</td>
                      <td className="mono">{num(cum)}</td>
                      <td className="mono">{won(r.spend)}</td>
                      <td className="mono">{num(r.impressions)}</td>
                      <td className="mono">{num(r.clicks)}</td>
                      <td className="mono">{r.impressions && r.clicks ? pct((r.clicks / r.impressions) * 100, 2) : "—"}</td>
                      <td className="mono">{r.spend ? won(r.spend / r.leads) : "—"}</td>
                      <td className="mono">{r.sales ? num(r.sales) : "—"}</td>
                      <td className="mono">{r.revenue ? manwon(r.revenue) : "—"}</td>
                    </tr>
                  );
                });
              })()}
              <tr className="total">
                <td>합계</td>
                <td className="mono">—</td>
                <td className="mono">{num(sum.leads)}</td>
                <td className="mono">{num(sum.leads)}</td>
                <td className="mono">{won(sum.spend)}</td>
                <td className="mono">{num(sum.impressions)}</td>
                <td className="mono">{num(sum.clicks)}</td>
                <td className="mono">{pct(sum.ctr, 2)}</td>
                <td className="mono">{won(sum.cpa)}</td>
                <td className="mono">{num(sum.sales)}</td>
                <td className="mono">{manwon(sum.revenue)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="foot" style={{ marginTop: 6, fontSize: 11 }}>
          출처: {bench.meta.source} · {bench.meta.note}
        </div>
      </details>
    </div>
  );
}
