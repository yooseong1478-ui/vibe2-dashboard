"use client";

// 홈 추이 차트 4개 (2열 그리드).
//   A. 일별 알림신청 — 실측 막대 + 계획 라인
//   B. 일 CPA — 신호등 존(그린/옐로/레드) 배경 밴드 + 일 CPA + 3일 이동
//   C. 일별 지출 — 실측 막대(플랜 초과일은 진하게) + 일예산 플랜 라인
//   D. 페이스 갭 — 누적 실측 − 누적 목표 편차 면적 차트, [알림|지출] 토글
//      (누적 알림/누적 지출 개별 차트 2개를 이 한 장으로 대체 — "앞서나 뒤처지나"만 본다)

import { useMemo, useState } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Tooltip,
  Legend,
  Filler,
  type ChartData,
  type ChartOptions,
  type Plugin,
} from "chart.js";
import { Bar, Line } from "react-chartjs-2";
import { useTokens } from "./useTokens";

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Tooltip, Legend, Filler);

export interface HomeChartsProps {
  labels: string[];
  // A
  planPerDay: number[];
  actualDaily: (number | null)[];
  // B
  cpaDaily: (number | null)[];
  cpaRolling: (number | null)[];
  zoneGreenMax: number;   // 그린존 상한 (signalGreenMax)
  zoneYellowMax: number;  // 옐로존 상한 = 하드캡 (초과 시 레드존)
  // C
  planSpendDaily: number[];
  spendDaily: (number | null)[];
  // D
  gapLeads: (number | null)[];  // 누적 실측 알림 − 누적 목표 알림
  gapSpend: (number | null)[];  // 누적 실측 지출 − 누적 목표 지출
  // 공통
  liveFrom: number;
  liveTo: number;
  liveLabel: string;
}

const won = (v: number) => "₩" + Math.round(v).toLocaleString("ko-KR");
function moneyTick(v: number): string {
  const a = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (a >= 100000000) return `${sign}${(a / 100000000).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}억`;
  if (a >= 10000) return `${sign}${Math.round(a / 10000).toLocaleString("ko-KR")}만`;
  return (v < 0 ? "-" : "") + won(a);
}
const numTick = (v: number) => Math.round(v).toLocaleString("ko-KR");

export default function HomeCharts(props: HomeChartsProps) {
  // 페이스 갭 토글 — 알림 실측이 아직 없으면 지출 기준을 기본으로
  const hasLeadGap = props.gapLeads.some((v) => v != null);
  const [gapMode, setGapMode] = useState<"leads" | "spend">(hasLeadGap ? "leads" : "spend");
  const read = useTokens();

  const text = read("--text-3");
  const grid = read("--border", 0.7);
  const blue = read("--chart-1");
  const blueFill = read("--chart-1", 0.14);
  const gray = read("--chart-5", 0.75);
  const green = read("--success");
  const greenFill = read("--success", 0.16);
  const yellow = read("--warning");
  const danger = read("--danger");
  const dangerFill = read("--danger", 0.16);
  const warnFill = read("--warning", 0.2);
  const orange = "hsl(25 90% 55%)";

  // LIVE 구간 음영 (라벨은 DOM 범례 — 캔버스에 그리면 가장자리에서 잘린다)
  const liveShade: Plugin<"line" | "bar"> = useMemo(
    () => ({
      id: "liveShade",
      beforeDatasetsDraw(chart) {
        if (props.liveFrom < 0) return;
        const xScale = chart.scales.x as any;
        if (!xScale) return;
        const { top, bottom } = chart.chartArea;
        const ctx = chart.ctx;
        const half = (xScale.getPixelForValue(1) - xScale.getPixelForValue(0)) / 2 || 6;
        const x1 = xScale.getPixelForValue(props.liveFrom) - half;
        const x2 = xScale.getPixelForValue(props.liveTo) + half;
        ctx.save();
        ctx.fillStyle = read("--success", 0.1);
        ctx.fillRect(x1, top, Math.max(x2 - x1, 2), bottom - top);
        ctx.strokeStyle = green;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x1, top); ctx.lineTo(x1, bottom);
        ctx.moveTo(x2, top); ctx.lineTo(x2, bottom);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      },
    }),
    [props.liveFrom, props.liveTo, green, read]
  );

  // CPA 신호 존 배경 — 그린(≤greenMax) / 옐로(≤하드캡) / 레드(초과). noma5 기준선 밴드 방식.
  const cpaZones: Plugin<"line"> = useMemo(
    () => ({
      id: "cpaZones",
      beforeDatasetsDraw(chart) {
        const y = chart.scales.y as any;
        if (!y) return;
        const { left, right, top, bottom } = chart.chartArea;
        const ctx = chart.ctx;
        const py = (v: number) => Math.min(Math.max(y.getPixelForValue(v), top), bottom);
        const gY = py(props.zoneGreenMax);
        const yY = py(props.zoneYellowMax);
        ctx.save();
        ctx.fillStyle = read("--success", 0.07);
        ctx.fillRect(left, gY, right - left, bottom - gY);            // 그린존
        ctx.fillStyle = read("--warning", 0.07);
        ctx.fillRect(left, yY, right - left, gY - yY);                // 옐로존
        ctx.fillStyle = read("--danger", 0.06);
        ctx.fillRect(left, top, right - left, yY - top);              // 레드존
        // 경계선 + 라벨 (차트 영역 안 오른쪽 정렬 — noma5 와 동일)
        for (const l of [
          { v: props.zoneGreenMax, c: green, t: `그린 ${props.zoneGreenMax.toLocaleString()}` },
          { v: props.zoneYellowMax, c: danger, t: `캡 ${props.zoneYellowMax.toLocaleString()}` },
        ]) {
          const p = py(l.v);
          ctx.strokeStyle = l.c;
          ctx.setLineDash([3, 3]);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(left, p);
          ctx.lineTo(right, p);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = l.c;
          ctx.font = "600 9px sans-serif";
          ctx.textAlign = "right";
          ctx.fillText(l.t, right - 2, p - 3);
        }
        ctx.restore();
      },
    }),
    [props.zoneGreenMax, props.zoneYellowMax, green, danger, read]
  );

  const baseOptions = (tickFmt: (v: number) => string, tipFmt?: (v: number) => string): ChartOptions<any> => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { labels: { color: text, boxWidth: 12, font: { size: 11 } }, position: "top" },
      tooltip: {
        callbacks: {
          label: (c: any) =>
            `${c.dataset.label}: ${c.parsed.y == null ? "—" : (tipFmt ?? tickFmt)(c.parsed.y)}`,
        },
      },
    },
    scales: {
      x: { ticks: { color: text, font: { size: 10 }, maxRotation: 0, autoSkip: true }, grid: { color: grid } },
      y: {
        ticks: { color: text, font: { size: 10 }, callback: (v: any) => tickFmt(Number(v)) },
        grid: { color: grid },
        beginAtZero: true,
      },
    },
  });

  // ── A. 일별 알림 — 실측 막대 + 계획 라인 ──
  const dataA: ChartData<any> = {
    labels: props.labels,
    datasets: [
      { type: "line" as const, label: "계획", data: props.planPerDay, borderColor: gray, borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, tension: 0.15, order: 1 },
      { type: "bar" as const, label: "실측", data: props.actualDaily as number[], backgroundColor: blue, borderRadius: 3, order: 2 },
    ],
  };

  // ── B. 일 CPA — 존 밴드 + 일 CPA + 3일 이동 ──
  const dataB: ChartData<"line"> = {
    labels: props.labels,
    datasets: [
      { label: "일 CPA", data: props.cpaDaily as number[], borderColor: gray, borderDash: [3, 3], borderWidth: 1, pointRadius: 2, pointBackgroundColor: gray, tension: 0.2, spanGaps: false },
      { label: "3일 이동", data: props.cpaRolling as number[], borderColor: orange, borderWidth: 3, pointRadius: 0, tension: 0.25, spanGaps: false },
    ],
  };
  const optsB: ChartOptions<any> = {
    ...baseOptions(moneyTick, won),
    scales: {
      x: { ticks: { color: text, font: { size: 10 }, maxRotation: 0, autoSkip: true }, grid: { color: grid } },
      y: {
        ticks: { color: text, font: { size: 10 }, callback: (v: any) => moneyTick(Number(v)) },
        grid: { color: grid },
        beginAtZero: true,
        // 레드존이 항상 보이도록 상한을 캡 위로 — 실측이 튀어도 존이 눌리지 않게 고정
        suggestedMax: Math.round(props.zoneYellowMax * 1.35),
      },
    },
  };

  // ── C. 일별 지출 — 플랜 초과일은 진한 막대 ──
  const spendColors = props.spendDaily.map((v, i) =>
    v != null && v > (props.planSpendDaily[i] ?? Infinity) ? blue : blueFill
  );
  const dataC: ChartData<any> = {
    labels: props.labels,
    datasets: [
      { type: "line" as const, label: "일예산", data: props.planSpendDaily, borderColor: gray, borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, tension: 0.15, order: 1 },
      { type: "bar" as const, label: "지출", data: props.spendDaily as number[], backgroundColor: spendColors, borderColor: blue, borderWidth: 1, borderRadius: 3, order: 2 },
    ],
  };

  // ── D. 페이스 갭 — 0선 기준 위/아래를 다른 색 면적으로 ──
  const gap = gapMode === "leads" ? props.gapLeads : props.gapSpend;
  const gapPos = gap.map((v) => (v != null && v >= 0 ? v : null));
  const gapNeg = gap.map((v) => (v != null && v < 0 ? v : null));
  // 알림: 위(앞서감)=초록 / 아래(뒤처짐)=빨강.
  // 지출: 위=과집행이라 초록 대신 주황(경고), 아래(예산 절약)=초록.
  const posColor = gapMode === "leads" ? green : yellow;
  const posFill = gapMode === "leads" ? greenFill : warnFill;
  const negColor = gapMode === "leads" ? danger : green;
  const negFill = gapMode === "leads" ? dangerFill : greenFill;
  const dataD: ChartData<"line"> = {
    labels: props.labels,
    datasets: [
      { label: gapMode === "leads" ? "앞서감" : "플랜 초과", data: gapPos as number[], borderColor: posColor, backgroundColor: posFill, borderWidth: 2, pointRadius: 0, fill: "origin", tension: 0.15, spanGaps: false },
      { label: gapMode === "leads" ? "뒤처짐" : "플랜 미만", data: gapNeg as number[], borderColor: negColor, backgroundColor: negFill, borderWidth: 2, pointRadius: 0, fill: "origin", tension: 0.15, spanGaps: false },
    ],
  };
  const gapFmt = gapMode === "leads" ? (v: number) => `${v > 0 ? "+" : ""}${numTick(v)}명` : (v: number) => `${v > 0 ? "+" : ""}${moneyTick(v)}`;
  const optsD: ChartOptions<any> = {
    ...baseOptions(gapMode === "leads" ? numTick : moneyTick, gapFmt),
    scales: {
      x: { ticks: { color: text, font: { size: 10 }, maxRotation: 0, autoSkip: true }, grid: { color: grid } },
      y: {
        ticks: { color: text, font: { size: 10 }, callback: (v: any) => (gapMode === "leads" ? numTick(Number(v)) : moneyTick(Number(v))) },
        grid: { color: grid },
        // 0선을 반드시 포함 (양/음 대칭일 필요는 없음)
        beginAtZero: true,
      },
    },
  };

  const Band = () =>
    props.liveFrom >= 0 ? (
      <span className="desc" style={{ marginLeft: 8, display: "inline-flex", alignItems: "center", gap: 5 }}>
        <span style={{ width: 10, height: 10, borderRadius: 3, background: "hsl(var(--success) / 0.2)", border: "1px dashed hsl(var(--success))", display: "inline-block" }} />
        {props.liveLabel}
      </span>
    ) : null;

  return (
    <div className="chartgrid">
      <div className="card cchart">
        <div className="section-title">일별 알림 — 계획 vs 실측<Band /></div>
        <div className="chart-box" style={{ marginTop: 8 }}>
          <Bar data={dataA} options={baseOptions(numTick, (v) => `${numTick(v)}명`)} plugins={[liveShade]} />
        </div>
      </div>

      <div className="card cchart">
        <div className="section-title">일 CPA — 신호등 밴드<Band /></div>
        <div className="chart-box" style={{ marginTop: 8 }}>
          <Line data={dataB} options={optsB} plugins={[liveShade, cpaZones]} />
        </div>
      </div>

      <div className="card cchart">
        <div className="section-title">
          일별 지출 — 계획 vs 실측
          <span className="desc" style={{ marginLeft: 6 }}>플랜 초과일 진하게</span>
          <Band />
        </div>
        <div className="chart-box" style={{ marginTop: 8 }}>
          <Bar data={dataC} options={baseOptions(moneyTick, won)} plugins={[liveShade]} />
        </div>
      </div>

      <div className="card cchart">
        <div className="section-title">
          페이스 갭 — 누적 실측 − 누적 목표
          <span className="tip" data-tip="0선 위면 목표보다 앞서감, 아래면 뒤처짐. 누적 알림/누적 지출 차트를 편차 하나로 요약." role="img" aria-label="설명">ⓘ</span>
        </div>
        <div className="seg" style={{ margin: "8px 0 4px" }}>
          <button className={gapMode === "leads" ? "on" : ""} onClick={() => setGapMode("leads")}>알림 기준</button>
          <button className={gapMode === "spend" ? "on" : ""} onClick={() => setGapMode("spend")}>지출 기준</button>
        </div>
        <div className="chart-box">
          <Line data={dataD} options={optsD} plugins={[liveShade]} />
        </div>
      </div>
    </div>
  );
}
