import { getDataset } from "@/lib/dataStore";
import { getTestingAdsCached } from "@/lib/meta";
import { bandsForDate, todayKST } from "@/lib/metrics";
import CreativesTabs from "@/components/CreativesTabs";
import ThemeToggle from "@/components/ThemeToggle";

export const dynamic = "force-dynamic";

// 소재 상세 페이지 — 대시보드는 요약 1줄만 유지하고, 소재 딥다이브는 여기서.
export default async function CreativesPage() {
  const { data } = await getDataset();
  const testing = await getTestingAdsCached(Date.now());

  return (
    <>
      <header className="header">
        <div className="brand">
          <div className="logo">V2</div>
          <div>
            <h1>소재 상세</h1>
            <div className="sub">러닝 랭킹 · 테스트 중 소재</div>
          </div>
        </div>
        <div className="header-right">
          <ThemeToggle />
          <a className="btn-primary" href="/">← 현황판</a>
        </div>
      </header>
      <main className="wrap" style={{ paddingTop: 18 }}>
      <CreativesTabs
        block={data?.creatives ?? null}
        testing={testing}
        goodCpa={data ? bandsForDate(data, todayKST(Date.now())).yellow : 9000}
        capCpa={data ? bandsForDate(data, todayKST(Date.now())).freeze : 11000}
      />
      <div className="footer-links"><a href="/">← 현황판으로</a></div>
      </main>
    </>
  );
}
