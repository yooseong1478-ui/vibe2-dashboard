"use client";

import { useEffect, useState } from "react";

// 라이트/다크 토글. 3상태(시스템 기본 / light / dark) 중 사용자가 고른 값만 localStorage 에 남긴다.
// 페인트 전 적용은 app/layout.tsx 의 인라인 스크립트가 담당한다(여기서 하면 깜빡인다).
export default function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);

  useEffect(() => {
    const saved = document.documentElement.getAttribute("data-theme");
    if (saved === "dark" || saved === "light") {
      setTheme(saved);
      return;
    }
    setTheme(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("theme", next);
    } catch {
      // 사파리 프라이빗 모드 등 — 저장 실패해도 이번 세션 전환은 유효
    }
  }

  return (
    <button className="theme-toggle" onClick={toggle} title="테마 전환" aria-label="테마 전환">
      {theme === "dark" ? "☀️" : "🌙"}
    </button>
  );
}
