"use client";

// 1기 vs 2기 D-day 정렬 비교 차트. 달력 날짜가 아니라 1차 LIVE 를 D0 으로 맞춰 겹쳐본다.
// 기본 축은 "목표 대비 %" — 1기 최종 7,960 과 2기 목표 30,000 을 각각 100% 로 놓으면
// 규모가 3.77배 다른 두 기수가 같은 축에서 바로 겹친다. 절대값은 토글로 본다.

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

export interface ComparePointDTO {
  d: number;
  label: string;
  date1: string | null;
  date2: string | null;
  leads1: number | null;
  leads2: number | null;
  cum1: number | null;
  cum2: number | null;
  bench1Live: boolean;
  cpa1: number | null;
  cpa2: number | null;
  cumSpend1: number | null;
  cumSpend2: number | null;
  planCum2: number | null;
}

interface Props {
  points: ComparePointDTO[];
  scale: number;
  liveBand: { fromIndex: number; toIndex: number; label: string } | null;
  targetLeads: number;
  bench1Total: number;
  bench1Spend: number;
  totalBudget: number;
  capCpa: number; // CPA 축 상한 산정 기준 (하드캡)
}

const won = (v: number) => "₩" + Math.round(v).toLocaleString("ko-KR");
// 축 눈금용 금액 축약 — ₩150,000,000 은 축 폭을 다 먹는다
function moneyTick(v: number): string {
  const a = Math.abs(v);
  if (a >= 100000000) return `${(v / 100000000).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}억`;
  if (a >= 10000) return `${Math.round(v / 10000).toLocaleString("ko-KR")}만`;
  return won(v);
}
const pctTick = (v: number) => `${Math.round(v)}%`;

export default function CompareCharts({
  points,
  scale,
  liveBand,
  targetLeads,
  bench1Total,
  bench1Spend,
  totalBudget,
  capCpa,
}: Props) {
  const [asPct, setAsPct] = useState(true);
  const readToken = useTokens();

  const text = readToken("--text-3");
  const grid = readToken("--border", 0.7);
  const blue = readToken("--chart-1");
  const blueFill = readToken("--chart-1", 0.14);
  const gray = readToken("--chart-5", 0.75);
  const green = readToken("--success");
  const purple = "hsl(275 60% 58%)";
  const purpleSoft = "hsl(275 60% 58% / 0.10)";

  const labels = points.map((p) => p.label);

  // 목표 대비 % 변환 — 1기는 1기 최종 대비, 2기는 2기 목표 대비
  const r1 = (v: number | null, base: number) => (v === null ? null : asPct ? (v / base) * 100 : v);
  const cum1 = points.map((p) => r1(p.cum1, bench1Total));
  const cum2 = points.map((p) => r1(p.cum2, targetLeads));
  const plan2 = points.map((p) => r1(p.planCum2, targetLeads));
  const leads1 = points.map((p) => r1(p.leads1, bench1Total));
  const leads2 = points.map((p) => r1(p.leads2, targetLeads));
  const spend1 = points.map((p) => r1(p.cumSpend1, bench1Spend));
  const spend2 = points.map((p) => r1(p.cumSpend2, totalBudget));

  // LIVE 구간 음영 밴드 — 9/8·9/10 세로선 2개는 라벨이 서로 잘려서 밴드 하나로 합쳤다
  const liveShade: Plugin<"line" | "bar"> = useMemo(
    () => ({
      id: "liveShade",
      beforeDatasetsDraw(chart) {
        if (!liveBand || liveBand.fromIndex < 0) return;
        const xScale = chart.scales.x as any;
        if (!xScale) return;
        const { top, bottom } = chart.chartArea;
        const ctx = chart.ctx;
        const half = (xScale.getPixelForValue(1) - xScale.getPixelForValue(0)) / 2 || 6;
        const x1 = xScale.getPixelForValue(liveBand.fromIndex) - half;
        const x2 = xScale.getPixelForValue(liveBand.toIndex) + half;
        ctx.save();
        ctx.fillStyle = readToken("--success", 0.1);
        ctx.fillRect(x1, top, x2 - x1, bottom - top);
        ctx.strokeStyle = green;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x1, top);
        ctx.lineTo(x1, bottom);
        ctx.moveTo(x2, top);
        ctx.lineTo(x2, bottom);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
        // 라벨은 캔버스에 그리지 않는다 — 밴드가 축 오른쪽 끝에 붙어 있어 무슨 정렬을 써도
        // 글자가 잘린다. 대신 카드 제목 옆에 DOM 범례(BandNote)로 표시한다.
      },
    }),
    [liveBand, green]
  );

  // tickFmt = 축 눈금(축약), tipFmt = 툴팁(원본값)
  const baseOptions = (
    tickFmt?: (v: number) => string,
    tipFmt?: (v: number) => string,
    yMax?: number
  ): ChartOptions<any> => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { labels: { color: text, boxWidth: 12, font: { size: 11 } }, position: "top" },
      tooltip: {
        callbacks: {
          title: (items: any[]) => {
            const p = points[items[0].dataIndex];
            const parts = [p.label];
            if (p.date1) parts.push(`1기 ${p.date1.slice(5)}`);
            if (p.date2) parts.push(`2기 ${p.date2.slice(5)}`);
            return parts.join("  ·  ");
          },
          label: (c: any) => {
            if (c.parsed.y == null) return `${c.dataset.label}: —`;
            const f = tipFmt ?? tickFmt;
            return `${c.dataset.label}: ${f ? f(c.parsed.y) : c.parsed.y.toLocaleString("ko-KR")}`;
          },
        },
      },
    },
    scales: {
      x: { ticks: { color: text, font: { size: 10 }, maxRotation: 0, autoSkip: true }, grid: { color: grid } },
      y: {
        ticks: {
          color: text,
          font: { size: 10 },
          callback: (v: any) => (tickFmt ? tickFmt(Number(v)) : Number(v).toLocaleString("ko-KR")),
        },
        grid: { color: grid },
        beginAtZero: true,
        ...(yMax !== undefined ? { max: yMax } : {}),
      },
    },
  });

  // % 모드에서는 눈금/툴팁 모두 %, 절대값 모드에서는 명 단위
  const leadTick = asPct ? pctTick : (v: number) => Math.round(v).toLocaleString("ko-KR");
  const leadTip = asPct
    ? (v: number) => `${v.toFixed(1)}%`
    : (v: number) => `${Math.round(v).toLocaleString("ko-KR")}명`;
  const spendTick = asPct ? pctTick : moneyTick;
  const spendTip = asPct ? (v: number) => `${v.toFixed(1)}%` : won;

  const L1 = asPct ? `1기 (최종 ${bench1Total.toLocaleString("ko-KR")} = 100%)` : "1기";
  const L2 = asPct ? `2기 (목표 ${targetLeads.toLocaleString("ko-KR")} = 100%)` : "2기";

  // 1) 누적 알림신청
  const cumData: ChartData<"line"> = {
    labels,
    datasets: [
      {
        label: L1,
        data: cum1 as number[],
        borderColor: purple,
        backgroundColor: purpleSoft,
        pointRadius: 0,
        borderWidth: 2,
        fill: true,
        tension: 0.15,
      },
      {
        label: "2기 목표선",
        data: plan2 as number[],
        borderColor: gray,
        borderDash: [5, 4],
        pointRadius: 0,
        borderWidth: 1.5,
        fill: false,
        tension: 0.15,
      },
      {
        label: `${L2} 실측`,
        data: cum2 as number[],
        borderColor: blue,
        backgroundColor: blueFill,
        pointRadius: 0,
        borderWidth: 3,
        fill: true,
        tension: 0.15,
        spanGaps: false,
      },
    ],
  };

  // 2) 일별 알림신청
  const dailyData: ChartData<"bar"> = {
    labels,
    datasets: [
      { label: L1, data: leads1 as number[], backgroundColor: purpleSoft, borderColor: purple, borderWidth: 1, borderRadius: 3 },
      { label: `${L2} 실측`, data: leads2 as number[], backgroundColor: blue, borderRadius: 3 },
    ],
  };

  // 3) 일 CPA — %로 바꿀 대상이 아니라 항상 원. 축 상한은 하드캡×1.5 로 잘라
  //    초기 학습구간의 튄 값 때문에 정작 볼 3,000~6,000 구간이 눌리는 걸 막는다.
  const cpaMax = Math.round(capCpa * 1.5);
  const cpaData: ChartData<"line"> = {
    labels,
    datasets: [
      { label: "1기 일 CPA", data: points.map((p) => p.cpa1) as number[], borderColor: purple, borderDash: [3, 3], pointRadius: 0, borderWidth: 1.5, tension: 0.2, spanGaps: false },
      { label: "2기 일 CPA", data: points.map((p) => p.cpa2) as number[], borderColor: blue, pointRadius: 2, borderWidth: 3, tension: 0.2, spanGaps: false },
    ],
  };
  const clipped = points.filter((p) => (p.cpa1 ?? 0) > cpaMax || (p.cpa2 ?? 0) > cpaMax).length;

  // 4) 누적 지출
  const spendData: ChartData<"line"> = {
    labels,
    datasets: [
      { label: asPct ? `1기 (총 ${moneyTick(bench1Spend)} = 100%)` : "1기", data: spend1 as number[], borderColor: purple, backgroundColor: purpleSoft, pointRadius: 0, borderWidth: 1.5, fill: true, tension: 0.15 },
      { label: asPct ? `2기 (예산 ${moneyTick(totalBudget)} = 100%)` : "2기", data: spend2 as number[], borderColor: blue, backgroundColor: blueFill, pointRadius: 0, borderWidth: 3, fill: true, tension: 0.15, spanGaps: false },
    ],
  };

  // 캔버스 밖 밴드 범례 — 초록 스와치 + 설명
  const BandNote = () =>
    liveBand ? (
      <span className="desc" style={{ marginLeft: 8, display: "inline-flex", alignItems: "center", gap: 5 }}>
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: 3,
            background: "hsl(var(--success) / 0.2)",
            border: "1px dashed hsl(var(--success))",
            display: "inline-block",
          }}
        />
        {liveBand.label} {points[liveBand.fromIndex]?.label}~{points[liveBand.toIndex]?.label}
      </span>
    ) : null;

  return (
    <>
      <div className="seg" style={{ marginBottom: 10, flexWrap: "wrap" }}>
        <button className={asPct ? "on" : ""} onClick={() => setAsPct(true)}>
          목표 대비 %
        </button>
        <button className={asPct ? "" : "on"} onClick={() => setAsPct(false)}>
          절대값
        </button>
        <span style={{ fontSize: 11, color: "hsl(var(--text-3))", marginLeft: 8 }}>
          {asPct
            ? `1기 최종 ${bench1Total.toLocaleString("ko-KR")} 과 2기 목표 ${targetLeads.toLocaleString("ko-KR")} 을 각각 100% 로 — 파란선이 보라선 위면 1기보다 빠른 페이스`
            : `규모가 ×${scale.toFixed(2)} 차이라 1기 곡선은 아래에 깔린다. 페이스 비교는 % 축으로.`}
        </span>
      </div>
      <div className="chartgrid">
        <div className="card cchart">
          <div className="section-title">누적 알림신청 — 1기 vs 2기<BandNote /></div>
          <div className="chart-box">
            <Line data={cumData} options={baseOptions(leadTick, leadTip)} plugins={[liveShade]} />
          </div>
        </div>
        <div className="card cchart">
          <div className="section-title">일별 알림신청 — 1기 vs 2기<BandNote /></div>
          <div className="chart-box">
            <Bar data={dailyData} options={baseOptions(leadTick, leadTip)} plugins={[liveShade]} />
          </div>
        </div>
        <div className="card cchart">
          <div className="section-title">
            일 CPA — 1기 vs 2기
            <span className="desc" style={{ marginLeft: 6 }}>
              축 상한 {won(cpaMax)}
              {clipped > 0 ? ` · 초과 ${clipped}일 잘림` : ""}
            </span>
            <BandNote />
          </div>
          <div className="chart-box">
            <Line data={cpaData} options={baseOptions(moneyTick, won, cpaMax)} plugins={[liveShade]} />
          </div>
        </div>
        <div className="card cchart">
          <div className="section-title">누적 지출 — 1기 vs 2기<BandNote /></div>
          <div className="chart-box">
            <Line data={spendData} options={baseOptions(spendTick, spendTip)} plugins={[liveShade]} />
          </div>
        </div>
      </div>
    </>
  );
}
