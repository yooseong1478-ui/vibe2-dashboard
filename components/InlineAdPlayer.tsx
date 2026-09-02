"use client";

// 카드 안 인라인 광고 플레이어 — 클릭하면 그 자리에서 공식 미리보기(iframe)가 재생된다.
// (계정 토큰이 video 노드 권한이 없어 mp4 직재생 불가 — /api/preview 의 iframe 이 유일한 재생 수단.)
// 메타 iframe 은 고정 픽셀(예: 335×450)로 오므로 카드 폭에 맞춰 transform: scale 로 줄인다.
import { useEffect, useRef, useState } from "react";

interface Props {
  adId?: string | null;
  thumb?: string | null;
  isVideo: boolean;
  name: string;
}

export default function InlineAdPlayer({ adId, thumb, isVideo, name }: Props) {
  const [state, setState] = useState<"idle" | "loading" | "playing" | "error">("idle");
  const [frame, setFrame] = useState<{ src: string; w: number; h: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [boxW, setBoxW] = useState(0);

  // 컨테이너 폭 추적 (반응형 스케일)
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBoxW(el.clientWidth));
    ro.observe(el);
    setBoxW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  async function play(e: React.MouseEvent) {
    e.stopPropagation();
    if (!adId || state === "loading") return;
    if (state === "playing") return;
    setState("loading");
    try {
      const j = await fetch(`/api/preview?adId=${adId}`).then((r) => r.json());
      if (!j.ok || !j.body) throw new Error(j.error || "미리보기 실패");
      // iframe 스니펫에서 src·크기 추출
      const src = /src="([^"]+)"/.exec(j.body)?.[1];
      const w = Number(/width="(\d+)"/.exec(j.body)?.[1] ?? 335);
      const h = Number(/height="(\d+)"/.exec(j.body)?.[1] ?? 450);
      if (!src) throw new Error("iframe 파싱 실패");
      setFrame({ src: src.replace(/&amp;/g, "&"), w, h });
      setState("playing");
    } catch {
      setState("error");
    }
  }

  function stop(e: React.MouseEvent) {
    e.stopPropagation();
    setFrame(null);
    setState("idle");
  }

  if (state === "playing" && frame) {
    const scale = boxW > 0 ? Math.min(1, boxW / frame.w) : 1;
    return (
      <div ref={boxRef} className="iap playing" style={{ height: Math.round(frame.h * scale) }}>
        <iframe
          src={frame.src}
          width={frame.w}
          height={frame.h}
          style={{ transform: `scale(${scale})`, transformOrigin: "top left", border: 0 }}
          scrolling="no"
          title={name}
        />
        <button className="iap-close" onClick={stop} title="닫기">✕</button>
      </div>
    );
  }

  return (
    <div ref={boxRef} className={`cthumb iap ${isVideo ? "video" : ""} ${!thumb ? "ph" : ""}`} onClick={play} role="button" title="카드 안에서 광고 재생">
      {thumb ? <img src={thumb} alt={name} loading="lazy" /> : <span>{isVideo ? "🎬" : "🖼"}</span>}
      {adId && (
        <span className={`play iap-play ${state === "loading" ? "loading" : ""}`}>
          {state === "loading" ? "…" : "▶"}
        </span>
      )}
      {state === "error" && <span className="iap-err">미리보기 실패</span>}
    </div>
  );
}
