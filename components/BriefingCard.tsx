"use client";
import { useState } from "react";

// 팩트 5줄 고정 브리핑. 텍스트는 서버에서 조립해 내려받고, 여기선 표시+클립보드 복사만.
export default function BriefingCard({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // clipboard 미지원 브라우저: 선택 안내
      alert("복사 실패 — 텍스트를 길게 눌러 직접 복사해주세요.");
    }
  }
  const lines = text.split("\n");
  return (
    <div className="card briefing">
      <div className="bhead">
        <span>{lines[0]}</span>
        <button className="bcopy" onClick={copy}>{copied ? "✓ 복사됨" : "📋 복사"}</button>
      </div>
      <div className="bbody">
        {lines.slice(1).map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
    </div>
  );
}
