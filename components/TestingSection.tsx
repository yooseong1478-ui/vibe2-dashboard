"use client";
import { useState } from "react";
import AdPreviewModal from "./AdPreviewModal";
import type { TestingAdsResult, TestingAd } from "@/lib/meta";
import { won, num, pct, shortDate } from "@/lib/format";

// 상태뱃지: 🌱 학습중(노출<500) / ✅ 안착 ≤goodCpa / 🟡 관찰 ≤capCpa / 🔴 위험 >capCpa
function judge(ad: TestingAd, goodCpa: number, capCpa: number): { badge: string; cls: string; learning: boolean } {
  if (ad.impressions < 500) return { badge: "🌱 학습중", cls: "mute", learning: true };
  const cpa = ad.openEvents ? ad.spend / ad.openEvents : Infinity;
  if (cpa <= goodCpa) return { badge: "✅ 안착", cls: "pos", learning: false };
  if (cpa <= capCpa) return { badge: "🟡 관찰", cls: "warn", learning: false };
  return { badge: "🔴 위험", cls: "neg", learning: false };
}

export default function TestingSection({ result, goodCpa, capCpa }: { result: TestingAdsResult; goodCpa: number; capCpa: number }) {
  const [zoom, setZoom] = useState<TestingAd | null>(null);
  // 기본은 판정 가능한 소재만(안착/관찰/위험). 🌱 학습중은 토글 뒤로.
  const [showLearning, setShowLearning] = useState(false);
  const items = result.items;
  if (!items.length) return null;

  const judged = items.map((ad) => ({ ad, j: judge(ad, goodCpa, capCpa) }));
  const settled = judged.filter(({ j }) => j.badge.startsWith("✅")).length;
  const learning = judged.filter(({ j }) => j.learning).length;
  const risky = judged.filter(({ j }) => j.badge.startsWith("🔴")).length;
  const mature = judged.filter(({ j, ad }) => !j.learning && ad.openEvents > 0);
  const wSpend = mature.reduce((s, { ad }) => s + ad.spend, 0);
  const wOe = mature.reduce((s, { ad }) => s + ad.openEvents, 0);
  const weightedCpa = wOe ? wSpend / wOe : null;

  // 등록일별 그룹 (최신일 먼저) — 기본은 학습중 제외
  const visible = judged.filter((r) => showLearning || !r.j.learning);
  const groups = new Map<string, typeof judged>();
  for (const row of visible) {
    const g = groups.get(row.ad.createdDate) || [];
    g.push(row);
    groups.set(row.ad.createdDate, g);
  }
  const collected = new Date(Date.parse(result.collectedAt)).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="section" id="testing">
      <div className="eyebrow">
        🧪 테스트 중 소재 <span className="desc">최근 3일 등록 · 등록일부터 누적 · {collected} 수집</span>
      </div>
      <div className="card" style={{ padding: "10px 14px", marginBottom: 10, fontSize: 13, fontWeight: 600 }}>
        안착 {settled} / 학습중 {learning} / 위험 {risky}
        <span style={{ color: "hsl(var(--text-3))", fontWeight: 500 }}> · 신규 가중 CPA </span>
        {weightedCpa ? won(weightedCpa) : "—"}
        <span className="hint" style={{ display: "block", marginTop: 2 }}>가중 CPA = 노출 500↑ 소재의 Σ지출 ÷ ΣopenEvent</span>
      </div>
      {learning > 0 && (
        <button className="morebtn" style={{ marginBottom: 12, marginTop: 0 }} onClick={() => setShowLearning(!showLearning)}>
          {showLearning ? "🌱 학습중 접기 ↑" : `🌱 학습중 ${learning}개 보기 ↓ (노출 500 미만 · 판단 보류)`}
        </button>
      )}
      {visible.length === 0 && <div className="card hint">판정 가능한 소재가 아직 없습니다 (전부 학습중).</div>}
      {[...groups.entries()].map(([date, rows]) => (
        <div key={date} style={{ marginBottom: 14 }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>{shortDate(date)} 등록 {rows.length}개</div>
          <div className="cgallery">
            {rows.map(({ ad, j }) => {
              const cpa = ad.openEvents ? ad.spend / ad.openEvents : null;
              return (
                <button key={ad.adId} className="ccard" onClick={() => setZoom(ad)}>
                  <div className={`cthumb ${ad.isVideo ? "video" : ""} ${!ad.thumb ? "ph" : ""}`}>
                    {ad.thumb ? <img src={ad.thumb} alt={ad.name} loading="lazy" /> : <span>{ad.isVideo ? "🎬" : "🖼"}</span>}
                    {ad.isVideo && ad.thumb && <span className="play">▶</span>}
                  </div>
                  <div className="cbody">
                    <div className="cname" title={ad.name}>{ad.name}</div>
                    <div className="cmeta">
                      <span className={`dot ${ad.on ? "on" : "off"}`} />{ad.on ? "ON" : "OFF"}
                      <span className="csep">·</span>{won(ad.spend)}
                      {ad.nameMismatch && <span className="chip warn" style={{ marginLeft: 4 }}>⚠ 명명 불일치</span>}
                    </div>
                    <div className="cstats">
                      <span>전환 <b>{num(ad.openEvents)}</b></span>
                      <span style={j.learning ? { color: "hsl(var(--text-3))" } : undefined}>
                        CPA <b style={j.learning ? { color: "hsl(var(--text-3))" } : undefined}>{won(cpa)}</b>
                      </span>
                    </div>
                    <div style={{ marginTop: 6 }}>
                      <span className={`chip ${j.cls}`}>{j.badge}</span>
                      <span className="hint" style={{ marginLeft: 6 }}>노출 {num(ad.impressions)} · CTR {pct(ad.ctr, 2)}</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {zoom && (
        <AdPreviewModal
          adId={zoom.adId}
          name={zoom.name}
          thumb={zoom.thumb}
          isVideo={zoom.isVideo}
          on={zoom.on}
          stats={{ spend: zoom.spend, impressions: zoom.impressions, clicks: zoom.clicks, ctr: zoom.ctr, openEvents: zoom.openEvents }}
          onClose={() => setZoom(null)}
        />
      )}
    </div>
  );
}
