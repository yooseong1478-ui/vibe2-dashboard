"use client";
import { useState } from "react";
import { won, num, shortDate } from "@/lib/format";

export interface AdsetRow {
  adsetId: string;
  name: string;
  campaignId: string;
  spend: number;
  impressions: number;
  clicks: number;
  openEvents: number;
}

interface Props {
  latest: AdsetRow[];
  latestDate: string | null;
  agg: AdsetRow[];
  aggFrom: string | null;
  aggTo: string | null;
  capCpa: number;                 // 이 CPA 초과 시 붉게 (goals.signalFreezeMax)
  sectionId?: string;             // 앵커 id. 다른 섹션 안에 중첩될 땐 생략(id 중복 방지)
  mainCampaignId?: string | null; // 메인/AB 구분용. 미지정이면 뱃지를 숨긴다.
}

function withCalc(rows: AdsetRow[]) {
  return rows
    .map((r) => ({
      ...r,
      cpa: r.openEvents ? r.spend / r.openEvents : null,
      cpc: r.clicks ? r.spend / r.clicks : null,
      cpm: r.impressions ? (r.spend / r.impressions) * 1000 : null,
    }))
    // 랭킹 = 전환수(openEvent) 내림차순, 동률이면 CPA 낮은 순 (소재 섹션과 동일 기준)
    .sort((a, b) => (b.openEvents - a.openEvents) || ((a.cpa ?? Infinity) - (b.cpa ?? Infinity)));
}

export default function AdsetSection({ latest, latestDate, agg, aggFrom, aggTo, capCpa, mainCampaignId, sectionId }: Props) {
  const [mode, setMode] = useState<"latest" | "agg">("latest");
  // 최신일 탭: 당일 지출 0 세트 숨김 (합산 탭에는 표시)
  const rows = withCalc(mode === "latest" ? latest.filter((r) => r.spend > 0) : agg);
  const label =
    mode === "latest"
      ? latestDate ?? ""
      : aggFrom && aggTo
        ? `${shortDate(aggFrom)}~${shortDate(aggTo)} 합산`
        : "합산";

  return (
    <div className="section" id={sectionId}>
      <div className="eyebrow">세트별 성과 <span className="desc">{label} · 전환수 순 · CPA {capCpa.toLocaleString("ko-KR")} 초과 붉게</span></div>
      <div className="seg">
        <button className={mode === "latest" ? "on" : ""} onClick={() => setMode("latest")}>최신일 {latestDate ? `(${shortDate(latestDate)})` : ""}</button>
        <button className={mode === "agg" ? "on" : ""} onClick={() => setMode("agg")}>보유 기간 합산</button>
      </div>
      <div className="card table-scroll">
        <table>
          <thead>
            <tr><th>#</th><th>세트</th><th>지출</th><th>openEvent</th><th>CPA</th><th>CPC</th><th>CPM</th></tr>
          </thead>
          <tbody>
            {rows.map((a, idx) => (
              <tr key={a.adsetId} className={(a.cpa ?? 0) > capCpa ? "danger" : ""}>
                <td className="mono">{idx < 3 ? ["🥇", "🥈", "🥉"][idx] : idx + 1}</td>
                <td>
                  {mainCampaignId && (
                    <span className={`chip ${a.campaignId === mainCampaignId ? "info" : "mute"}`} style={{ marginRight: 6 }}>
                      {a.campaignId === mainCampaignId ? "메인" : "AB"}
                    </span>
                  )}
                  {a.name}
                </td>
                <td className="mono">{won(a.spend)}</td>
                <td className="mono">{num(a.openEvents)}</td>
                <td className="mono">{won(a.cpa)}</td>
                <td className="mono">{won(a.cpc)}</td>
                <td className="mono">{won(a.cpm)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign: "center", color: "hsl(var(--text-3))" }}>세트 데이터 없음</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
