"use client";

import { useEffect, useState } from "react";

// CSS 변수(HSL 트리플릿)를 읽어 hsl() 문자열로 돌려준다. 차트는 캔버스라 CSS 를 못 쓰므로
// 색을 JS 로 읽어야 하는데, 그러면 테마가 바뀌어도 자동 갱신되지 않는다.
// 그래서 (1) 시스템 다크모드 변경과 (2) ThemeToggle 이 바꾸는 data-theme 속성을
// 둘 다 감시해서 리렌더를 트리거한다.
export function useTokens() {
  const [, setTick] = useState(0);

  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", bump);
    const mo = new MutationObserver(bump);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      mq.removeEventListener("change", bump);
      mo.disconnect();
    };
  }, []);

  // SSR 에서는 문서가 없어 중립 회색을 준다. 캔버스는 클라이언트에서만 그려지므로
  // 이 값이 화면에 남지 않는다 — 단, DOM 인라인 스타일에는 절대 쓰지 말 것(하이드레이션 불일치).
  return (name: string, alpha = 1) => {
    if (typeof window === "undefined") return "#888";
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (!raw) return "#888";
    return alpha === 1 ? `hsl(${raw})` : `hsl(${raw} / ${alpha})`;
  };
}
