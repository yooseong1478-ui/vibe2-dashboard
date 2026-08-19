"use client";

import { useEffect, useState } from "react";

export interface NavItem {
  id: string;
  label: string;
}

// 섹션 점프 내비. 현재 보고 있는 섹션을 칩으로 표시한다(스크롤 스파이).
export default function SecNav({ items }: { items: NavItem[] }) {
  const [active, setActive] = useState(items[0]?.id ?? "");

  useEffect(() => {
    const els = items.map((i) => document.getElementById(i.id)).filter((e): e is HTMLElement => !!e);
    if (!els.length) return;

    // 헤더(sticky) 아래로 들어온 섹션 중 가장 위에 있는 것을 활성으로.
    // IntersectionObserver 만으로는 "화면에 여러 개 보일 때" 판정이 흔들려서 위치로 직접 고른다.
    const onScroll = () => {
      const headerH = parseInt(
        getComputedStyle(document.documentElement).getPropertyValue("--header-h") || "64",
        10
      );
      const line = headerH + 80;
      let cur = els[0].id;
      for (const el of els) {
        if (el.getBoundingClientRect().top <= line) cur = el.id;
      }
      setActive(cur);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [items]);

  return (
    <nav className="secnav">
      {items.map((i) => (
        <a key={i.id} href={`#${i.id}`} className={active === i.id ? "active" : ""}>
          {i.label}
        </a>
      ))}
    </nav>
  );
}
