"use client";
import { useState } from "react";
import type { CreativesBlock } from "@/lib/types";
import type { TestingAdsResult } from "@/lib/meta";
import CreativeSection from "./CreativeSection";
import TestingSection from "./TestingSection";

export default function CreativesTabs({ block, testing, goodCpa, capCpa }: { block: CreativesBlock | null; testing: TestingAdsResult | null; goodCpa: number; capCpa: number }) {
  const [tab, setTab] = useState<"running" | "testing">("running");
  return (
    <div>
      <div className="seg" style={{ marginTop: 4 }}>
        <button className={tab === "running" ? "on" : ""} onClick={() => setTab("running")}>🏆 러닝 랭킹</button>
        <button className={tab === "testing" ? "on" : ""} onClick={() => setTab("testing")}>
          🧪 테스트 중{testing ? ` (${testing.items.length})` : ""}
        </button>
      </div>
      {tab === "running" && (block ? <CreativeSection block={block} capCpa={capCpa} /> : <div className="card hint">소재 데이터 없음</div>)}
      {tab === "testing" &&
        (testing && testing.items.length ? (
          <TestingSection result={testing} goodCpa={goodCpa} capCpa={capCpa} />
        ) : (
          <div className="card hint" style={{ marginTop: 12 }}>최근 3일 등록 소재가 없거나 수집에 실패했습니다.</div>
        ))}
    </div>
  );
}
