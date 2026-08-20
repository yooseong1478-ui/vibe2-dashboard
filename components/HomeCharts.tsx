"use client";

// 홈 차트 2개. 예전에는 4개(일별 알림 / 지출·CPA / 누적 지출 / 누적 알림)를 한 화면에 늘어놨는데,
// 스캔 비용만 크고 판단에는 안 쓰여서 통합했다.
//   A. 추이 — [누적 알림 | 일별 알림 | 누적 지출] 토글 하나로 세 관점을 전환
//   B. 일 CPA — 일 CPA + 3일 이동 + 하드캡 기준선 (구 '지출·CPA 밴드' 차트를 흡수)

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
  planCumLeads: number[];
  actualCumLeads: (number | null)[];
  planPerDay: number[];
  actualDaily: (number | null)[];
  planCumSpend: number[];
  actualCumSpend: (number | null)[];
  cpaDaily: (number | null)[];
  cpaRolling: (number | null)[];
  capCpa: number;      // 하드캡 — 빨간 기준선
  targetCpa: number;   // 블렌디드 목표 CPA — 초록 기준선
  liveFrom: number;    // LIVE 구간 시작 인덱스 (-1 이면 없음)
  liveTo: number;
  liveLabel: string;
  hasActual: boolean;
}

const won = (v: number) => "₩" + Math.round(v).toLocaleString("ko-KR");
function moneyTick(v: number): string {
  const a = Math.abs(v);
  if (a >= 100000000) return `${(v / 100000000).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}억`;
  if (a >= 10000) return `${Math.round(v / 10000).toLocaleString("ko-KR")}만`;
  return won(v);
}
const numTick = (v: number) => Math.round(v).toLocaleString("ko-KR");

type Mode = "cumLeads" | "daily" | "cumSpend";
const MODES: { key: Mode; label: string }[] = [
  { key: "cumLeads", label: "누적 알림" },
  { key: "daily", label: "일별 알림" },
  { key: "cumSpend", label: "누적 지출" },
];

export default function HomeCharts(props: HomeChartsProps) {
  const [mode, setMode] = useState<Mode>("cumLeads");
  const read = useTokens();

  const text = read("--text-3");
  const grid = read("--border", 0.7);
  const blue = read("--chart-1");
  const blueFill = read("--chart-1", 0.14);
  const gray = read("--chart-5", 0.75);
  const green = read("--success");
  const danger = read("--danger");
  const orange = "hsl(25 90% 55%)";

  // LIVE 구간 음영 — 세로선 2개는 라벨이 겹쳐서 밴드 하나로 그린다(라벨은 DOM 범례로)
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

  // CPA 기준선 — 목표(초록) / 하드캡(빨강)
  const cpaLines: Plugin<"line"> = useMemo(
    () => ({
      id: "cpaLines",
      afterDatasetsDraw(chart) {
        const y = chart.scales.y as any;
        if (!y) return;
        const { left, right } = chart.chartArea;
        const ctx = chart.ctx;
        for (const l of [
          { v: props.targetCpa, c: green, t: `목표 ${won(props.targetCpa)}` },
          { v: props.capCpa, c: danger, t: `하드캡 ${won(props.capCpa)}` },
        ]) {
          const py = y.getPixelForValue(l.v);
          if (py < chart.chartArea.top || py > chart.chartArea.bottom) continue;
          ctx.save();
          ctx.strokeStyle = l.c;
          ctx.setLineDash([4, 3]);
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(left, py);
          ctx.lineTo(right, py);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = l.c;
          ctx.font = "600 9.5px sans-serif";
          ctx.textAlign = "right";
          ctx.fillText(l.t, right - 3, py - 4);
          ctx.restore();
        }
      },
    }),
    [props.targetCpa, props.capCpa, green, danger]
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

  const line = (label: string, data: (number | null)[], color: string, opts: any = {}) => ({
    label, data: data as number[], borderColor: color, pointRadius: 0, tension: 0.15, ...opts,
  });

  const A: Record<Mode, { data: ChartData<any>; opts: ChartOptions<any>; type: "line" | "bar" }> = {
    cumLeads: {
      type: "line",
      data: {
        labels: props.labels,
        datasets: [
          line("목표", props.planCumLeads, gray, { borderDash: [5, 4], borderWidth: 1.5, fill: false }),
          line("실측", props.actualCumLeads, blue, { borderWidth: 3, fill: true, backgroundColor: blueFill, spanGaps: false }),
        ],
      },
      opts: baseOptions(numTick, (v) => `${numTick(v)}명`),
    },
    daily: {
      type: "bar",
      data: {
        labels: props.labels,
        datasets: [
          { label: "계획", data: props.planPerDay, backgroundColor: gray, borderRadius: 3 },
          { label: "실측", data: props.actualDaily as number[], backgroundColor: blue, borderRadius: 3 },
        ],
      },
      opts: baseOptions(numTick, (v) => `${numTick(v)}명`),
    },
    cumSpend: {
      type: "line",
      data: {
        labels: props.labels,
        datasets: [
          line("목표", props.planCumSpend, gray, { borderDash: [5, 4], borderWidth: 1.5, fill: false }),
          line("실측", props.actualCumSpend, blue, { borderWidth: 3, fill: true, backgroundColor: blueFill, spanGaps: false }),
        ],
      },
      opts: baseOptions(moneyTick, won),
    },
  };

  const cpaData: ChartData<"line"> = {
    labels: props.labels,
    datasets: [
      line("일 CPA", props.cpaDaily, gray, { borderWidth: 1, borderDash: [3, 3], pointRadius: 2, pointBackgroundColor: gray, spanGaps: false }),
      line("3일 이동", props.cpaRolling, orange, { borderWidth: 3, tension: 0.25, spanGaps: false }),
    ],
  };
  // 기준선이 항상 보이도록 축 상한을 하드캡의 1.4배로 고정 — 실측이 없어도 밴드가 읽힌다
  const cpaOpts: ChartOptions<any> = {
    ...baseOptions(moneyTick, won),
    scales: {
      x: { ticks: { color: text, font: { size: 10 }, maxRotation: 0, autoSkip: true }, grid: { color: grid } },
      y: {
        ticks: { color: text, font: { size: 10 }, callback: (v: any) => moneyTick(Number(v)) },
        grid: { color: grid },
        beginAtZero: true,
        suggestedMax: Math.round(props.capCpa * 1.4),
      },
    },
  };

  const cur = A[mode];
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
        <div className="section-title">
          추이<Band />
        </div>
        <div className="seg" style={{ margin: "8px 0 4px" }}>
          {MODES.map((m) => (
            <button key={m.key} className={mode === m.key ? "on" : ""} onClick={() => setMode(m.key)}>
              {m.label}
            </button>
          ))}
        </div>
        <div className="chart-box">
          {cur.type === "bar" ? (
            <Bar data={cur.data} options={cur.opts} plugins={[liveShade]} />
          ) : (
            <Line data={cur.data} options={cur.opts} plugins={[liveShade]} />
          )}
        </div>
      </div>

      <div className="card cchart">
        <div className="section-title">
          일 CPA<Band />
        </div>
        <div className="chart-box" style={{ marginTop: 8 }}>
          <Line data={cpaData} options={cpaOpts} plugins={[liveShade, cpaLines]} />
        </div>
      </div>
    </div>
  );
}
