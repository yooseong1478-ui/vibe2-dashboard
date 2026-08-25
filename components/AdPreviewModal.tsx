"use client";

// 소재 미리보기 라이트박스 (CreativeSection·TestingSection 공용).
// 반드시 createPortal 로 document.body 에 렌더한다 — .section 의 등장 애니메이션(fadeUp)이
// transform 을 남겨 조상이 fixed 의 containing block 이 되므로, 섹션 안에 그리면
// 모달이 문서 좌표에 박혀 화면 밖(스크롤 위치에 따라 잘리거나 안 보임)으로 나간다.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export interface AdPreviewStats {
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  openEvents: number;
}

interface Props {
  adId?: string | null;
  name: string;
  thumb?: string | null;
  isVideo: boolean;
  on: boolean;
  stats?: AdPreviewStats | null;
  onClose: () => void;
}

const won = (n: number | null) => (n == null || !isFinite(n) ? "—" : "₩" + Math.round(n).toLocaleString("ko-KR"));
const num = (n: number) => n.toLocaleString("ko-KR");

export default function AdPreviewModal({ adId, name, thumb, isVideo, on, stats, onClose }: Props) {
  const [html, setHtml] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  useEffect(() => {
    if (!adId) { setState("error"); return; }
    let alive = true;
    setState("loading");
    fetch(`/api/preview?adId=${adId}`)
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        if (j.ok && j.body) { setHtml(j.body); setState("idle"); }
        else setState("error");
      })
      .catch(() => alive && setState("error"));
    return () => { alive = false; };
  }, [adId]);

  // ESC 로 닫기 + 배경 스크롤 잠금
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const cpa = stats && stats.openEvents ? stats.spend / stats.openEvents : null;
  const cpc = stats && stats.clicks ? stats.spend / stats.clicks : null;

  const node = (
    <div className="lightbox" onClick={onClose}>
      <div className="lbinner" onClick={(e) => e.stopPropagation()}>
        <button className="lbclose" onClick={onClose}>✕</button>
        <div className={`lbimg ${html ? "haspreview" : ""}`}>
          {html ? (
            <div className="lbpreview" dangerouslySetInnerHTML={{ __html: html }} />
          ) : thumb ? (
            <img src={thumb} alt={name} />
          ) : (
            <div className="cthumb ph"><span>{isVideo ? "🎬" : "🖼"}</span></div>
          )}
          {state === "loading" && <div className="lbloading">미리보기 불러오는 중…</div>}
        </div>
        <div className="lbname">{name}</div>
        <div className="lbtype">
          {isVideo ? "🎬 영상 소재" : "🖼 이미지 소재"} · {on ? "ON" : "OFF"}
          {state === "error" && <span className="lbnote" style={{ marginLeft: 6 }}>미리보기 불러오기 실패 — 썸네일 표시</span>}
        </div>
        {stats && (
          <div className="lbstats">
            <div><span>지출</span><b>{won(stats.spend)}</b></div>
            <div><span>노출</span><b>{num(stats.impressions)}</b></div>
            <div><span>클릭 · CTR</span><b>{num(stats.clicks)} · {stats.ctr.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}%</b></div>
            <div><span>openEvent</span><b>{num(stats.openEvents)}</b></div>
            <div><span>CPA</span><b>{won(cpa)}</b></div>
            <div><span>CPC</span><b>{won(cpc)}</b></div>
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(node, document.body);
}
