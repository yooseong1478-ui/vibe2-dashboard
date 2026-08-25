"use client";
import { useMemo, useState } from "react";
import AdPreviewModal from "./AdPreviewModal";
import type { CreativesBlock, CreativeItem, CreativeMetrics } from "@/lib/types";
import { won, num, pct, shortDate } from "@/lib/format";

type Period = "cumulative" | "latest";

function cpa(m: CreativeMetrics | null): number | null {
  if (!m || !m.openEvents) return null;
  return m.spend / m.openEvents;
}
function cpc(m: CreativeMetrics | null): number | null {
  if (!m || !m.clicks) return null;
  return m.spend / m.clicks;
}
function isOn(status: string) {
  return status === "ACTIVE";
}

function Thumb({ item }: { item: CreativeItem }) {
  const [broken, setBroken] = useState(false);
  const isVideo = item.objectType === "VIDEO";
  if (!item.thumb || broken) {
    return (
      <div className={`cthumb ph ${isVideo ? "video" : ""}`}>
        <span>{isVideo ? "🎬" : "🖼"}</span>
      </div>
    );
  }
  return (
    <div className={`cthumb ${isVideo ? "video" : ""}`}>
      {/* fbcdn 이미지: 토큰 없음. 만료/실패 시 플레이스홀더로 폴백 */}
      <img src={item.thumb} alt={item.name} loading="lazy" onError={() => setBroken(true)} />
      {isVideo && <span className="play">▶</span>}
    </div>
  );
}

const RANK = ["🥇 TOP 1", "🥈 TOP 2", "🥉 TOP 3"];
const MIN_IMPRESSIONS = 500; // 표본 부족 기준

export default function CreativeSection({ block, compact = false, capCpa }: { block: CreativesBlock; compact?: boolean; capCpa: number }) {
  const [period, setPeriod] = useState<Period>("cumulative");
  const [zoom, setZoom] = useState<CreativeItem | null>(null);
  const [showAll, setShowAll] = useState(false);


  const rows = useMemo(() => {
    const pick = (it: CreativeItem) => (period === "cumulative" ? it.cumulative : it.latest);
    return block.items
      .map((it) => {
        const m = pick(it);
        return { it, m, small: !m || m.impressions < MIN_IMPRESSIONS };
      })
      .filter((r) => r.m !== null)
      // 랭킹 = 전환수(openEvent) 내림차순, 동률이면 CPA 낮은 순. 표본 부족은 뒤로.
      .sort((a, b) =>
        a.small !== b.small
          ? (a.small ? 1 : -1)
          : (b.m!.openEvents - a.m!.openEvents) || ((cpa(a.m) ?? Infinity) - (cpa(b.m) ?? Infinity))
      );
  }, [block.items, period]);

  const galleryRows = compact ? rows.slice(0, 5) : showAll ? rows : rows.slice(0, 8);

  const periodLabel = period === "cumulative"
    ? `${shortDate(block.cumulativeFrom)}~${shortDate(block.cumulativeTo)}`
    : shortDate(block.latestDate);

  return (
    <div className="section" id="creatives">
      <div className="eyebrow">
        {compact ? "소재 TOP 5" : "소재별 실시간 효율"}{" "}
        <span className="desc">전환수 순 · {periodLabel}</span>
        {compact && <a href="/creatives" style={{ marginLeft: "auto", fontWeight: 700 }}>전체 보기 →</a>}
      </div>

      <div className="seg">
        <button className={period === "cumulative" ? "on" : ""} onClick={() => setPeriod("cumulative")}>전기간 누적</button>
        <button className={period === "latest" ? "on" : ""} onClick={() => setPeriod("latest")}>최신일 ({shortDate(block.latestDate)})</button>
      </div>

      {/* 갤러리 */}
      <div className="cgallery">
        {galleryRows.map(({ it, m, small }, idx) => (
          <button key={it.adId ?? it.creativeId} className={`ccard ${!small && idx < 3 ? `rank-${idx + 1}` : ""}`} onClick={() => setZoom(it)}>
            <Thumb item={it} />
            {!small && idx < 3 && <span className={`rankbadge r${idx + 1}`}>{RANK[idx]}</span>}
            {small && <span className="rankbadge small-sample">표본부족</span>}
            <div className="cbody">
              <div className="cname" title={it.name}>{it.name}</div>
              <div className="cmeta">
                <span className={`dot ${isOn(it.status) ? "on" : "off"}`} />{isOn(it.status) ? "ON" : "OFF"}
                <span className="csep">·</span>{won(m!.spend)}
              </div>
              <div className="cstats">
                <span>전환 <b>{num(m!.openEvents)}</b></span>
                <span className={(cpa(m) ?? 0) > capCpa ? "neg" : ""}>CPA <b>{won(cpa(m))}</b></span>
              </div>
            </div>
          </button>
        ))}
        {rows.length === 0 && <div className="card" style={{ color: "hsl(var(--text-3))" }}>해당 기간 소재 데이터 없음</div>}
      </div>
      {!compact && rows.length > 8 && (
        <button className="morebtn" onClick={() => setShowAll(!showAll)}>
          {showAll ? "접기 ↑" : `소재 ${rows.length - 8}개 더 보기 ↓`}
        </button>
      )}

      {/* 성과 테이블 (compact 모드에선 숨김) */}
      {!compact && (
      <div className="card table-scroll" style={{ marginTop: 12 }}>
        <table>
          <thead>
            <tr><th>#</th><th>소재</th><th>상태</th><th>지출</th><th>노출</th><th>클릭</th><th>CTR</th><th>openEvent</th><th>CPA</th><th>CPC</th></tr>
          </thead>
          <tbody>
            {rows.map(({ it, m, small }, idx) => (
              <tr key={it.adId ?? it.creativeId} className={(cpa(m) ?? 0) > capCpa ? "danger" : ""}>
                <td className="mono">{small ? "·" : idx < 3 ? ["🥇", "🥈", "🥉"][idx] : idx + 1}</td>
                <td>{it.name}{small && <span className="chip mute" style={{ marginLeft: 6 }}>표본부족</span>}</td>
                <td><span className={`chip ${isOn(it.status) ? "pos" : "mute"}`}>{isOn(it.status) ? "ON" : "OFF"}</span></td>
                <td className="mono">{won(m!.spend)}</td>
                <td className="mono">{num(m!.impressions)}</td>
                <td className="mono">{num(m!.clicks)}</td>
                <td className="mono">{pct(m!.ctr, 2)}</td>
                <td className="mono">{num(m!.openEvents)}</td>
                <td className="mono">{won(cpa(m))}</td>
                <td className="mono">{won(cpc(m))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}

      {/* 라이트박스 — 공용 모달 (포털: .section 의 fadeUp transform 이 fixed 기준을 깨므로 body 에 렌더) */}
      {zoom && (() => {
        const m = period === "cumulative" ? zoom.cumulative : zoom.latest;
        return (
          <AdPreviewModal
            adId={zoom.adId}
            name={zoom.name}
            thumb={zoom.thumb}
            isVideo={zoom.objectType === "VIDEO"}
            on={isOn(zoom.status)}
            stats={m ?? null}
            onClose={() => setZoom(null)}
          />
        );
      })()}
    </div>
  );
}
