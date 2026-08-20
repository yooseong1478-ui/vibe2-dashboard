// 1기 아카이브 — 홈에서 걷어낸 1기 비교/실적 일체를 여기로 분리했다.
// 홈은 "3초 안에 상태 파악"이 목적이라 과거 벤치마크는 별도 라우트로 뺀다.

import { getDataset } from "@/lib/dataStore";
import { computeView } from "@/lib/metrics";
import CompareSection from "@/components/CompareSection";
import ThemeToggle from "@/components/ThemeToggle";
import { summarizeBenchmark, buildCompare, type Benchmark } from "@/lib/benchmark";
import vibe1 from "@/data/vibe1.json";

export const dynamic = "force-dynamic";

export default async function Gen1Page() {
  const { data, error } = await getDataset();
  if (!data) {
    return (
      <main className="wrap" style={{ paddingTop: 24 }}>
        <div className="banner err">데이터를 불러오지 못했습니다. {error}</div>
      </main>
    );
  }

  const v = computeView(data, Date.now());
  const bench = vibe1 as unknown as Benchmark;
  const benchSum = summarizeBenchmark(bench);
  const cmp = buildCompare(bench, data, v.derived, v.planCurve);
  const liveDates = data.goals.liveDates?.length ? data.goals.liveDates : [data.goals.webinarDate];

  return (
    <>
      <header className="header">
        <div className="brand">
          <div className="logo">V2</div>
          <div>
            <h1>1기 아카이브</h1>
            <div className="sub">{bench.meta.campaignName} · 확정 실적 스냅샷</div>
          </div>
        </div>
        <div className="header-right">
          <ThemeToggle />
          <a className="btn-primary" href="/">← 현황판</a>
        </div>
      </header>
      <main className="wrap" style={{ paddingTop: 18 }}>
        <CompareSection
          bench={bench}
          sum={benchSum}
          cmp={cmp}
          targetLeads={data.goals.targetLeads}
          targetCpa={data.goals.targetCpa ?? Math.round(data.goals.totalBudget / data.goals.targetLeads)}
          totalBudget={data.goals.totalBudget}
          liveDates={liveDates}
          capCpa={data.goals.signalFreezeMax ?? 11000}
        />
        <div className="footer-links"><a href="/">← 현황판으로</a></div>
      </main>
    </>
  );
}
