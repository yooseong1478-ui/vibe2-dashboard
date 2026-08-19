"use client";

import { useMemo } from "react";
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

export interface ChartsProps {
  labels: string[];
  planPerDay: number[];
  actualDaily: (number | null)[];
  planCumSpend: number[];
  actualCumSpend: (number | null)[];
  planCumLeads: number[];
  actualCumLeads: (number | null)[];
  // LIVE(웨비나) 세로 마커 — 2기는 1차·2차 두 번이라 배열로 받는다
  liveMarkers: { index: number; label: string }[];
  liveLabel: string;   // 밴드에 한 번만 찍는 라벨 (예: "LIVE 9/8~9/10")
  // 일별 지출 + CPA (효율 차트, 이중축)
  spendDaily: (number | null)[];
  planSpendDaily: number[];   // 계획 일예산 — 실측이 없을 때 축 기준이자 계획 대비 집행 비교선
  cpaDaily: (number | null)[];
  cpaRolling: (number | null)[];
  cpaBands: { green: number; yellow: number; freeze: number };
  // 차트 카드 헤더 [큰 값, 서브텍스트]
  headers: { daily: [string, string]; eff: [string, string]; cumSpend: [string, string]; cumLeads: [string, string] };
}

const won = (v: number) => "₩" + Math.round(v).toLocaleString("ko-KR");
// 축 눈금용 금액 축약 — ₩150,000,000 은 축 폭을 다 먹는다
function moneyTick(v: number): string {
  const a = Math.abs(v);
  if (a >= 100000000) return `${(v / 100000000).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}억`;
  if (a >= 10000) return `${Math.round(v / 10000).toLocaleString("ko-KR")}만`;
  return won(v);
}

export default function Charts(props: ChartsProps) {
  const read = useTokens();
  const text = read("--text-3");
  const grid = read("--border", 0.7);
  const blue = read("--chart-1");
  const blueFill = read("--chart-1", 0.14);
  const gray = read("--chart-5", 0.75);
  const green = read("--success");
  const orange = "hsl(25 90% 55%)";
  const red = read("--danger");
  const yellow = read("--warning");

  // LIVE 구간 음영 밴드. 9/8·9/10 은 이틀 차이라 세로선 2개를 그리면 라벨이 서로 잘린다.
  // 첫 LIVE ~ 마지막 LIVE 를 하나의 밴드로 칠하고 라벨은 한 번만 쓴다.
  const webinarMarker: Plugin<"line" | "bar"> = useMemo(
    () => ({
      id: "webinarMarker",
      beforeDatasetsDraw(chart) {
        const ms = props.liveMarkers.filter((m) => m.index >= 0);
        if (!ms.length) return;
        const xScale = chart.scales.x as any;
        if (!xScale) return;
        const { top, bottom } = chart.chartArea;
        const ctx = chart.ctx;
        const half = (xScale.getPixelForValue(1) - xScale.getPixelForValue(0)) / 2 || 6;
        const x1 = xScale.getPixelForValue(ms[0].index) - half;
        const x2 = xScale.getPixelForValue(ms[ms.length - 1].index) + half;
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
        // 라벨은 캔버스에 그리지 않는다 — 밴드가 축 오른쪽 끝에 붙어 있어 글자가 잘린다.
        // 대신 카드 제목 옆에 DOM 범례(BandNote)로 표시한다.
      },
    }),
    [props.liveMarkers, green, read]
  );

  // tickFmt = 축 눈금(축약), tipFmt = 툴팁(원본값)
  const baseOptions = (tickFmt?: (v: number) => string, tipFmt?: (v: number) => string): ChartOptions<any> => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { labels: { color: text, boxWidth: 12, font: { size: 11 } }, position: "top" },
      tooltip: {
        callbacks: {
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
        ticks: { color: text, font: { size: 10 }, callback: (v: any) => (tickFmt ? tickFmt(Number(v)) : Number(v).toLocaleString("ko-KR")) },
        grid: { color: grid },
        beginAtZero: true,
      },
    },
  });

  // 실측이 하나도 없으면(집행 시작 전) 축이 0~1 로 잡혀 눈금이 "₩1 ₩0" 로 깨진다.
  // 그때는 계획값·신호등 밴드가 들어갈 만큼으로 축 범위를 고정한다.
  const hasSpend = props.spendDaily.some((v) => v != null);
  const hasCpa = props.cpaDaily.some((v) => v != null) || props.cpaRolling.some((v) => v != null);
  const planSpendMax = Math.max(1, ...props.planSpendDaily);

  // 1) 일별 필요 vs 실측
  const barData: ChartData<"bar"> = {
    labels: props.labels,
    datasets: [
      { label: "필요/일(계획)", data: props.planPerDay, backgroundColor: gray, borderRadius: 3, categoryPercentage: 0.8, barPercentage: 0.9 },
      { label: "실측 알림", data: props.actualDaily as number[], backgroundColor: blue, borderRadius: 3, categoryPercentage: 0.8, barPercentage: 0.9 },
    ],
  };

  // 2) 누적 지출 실측 vs 목표
  const spendData: ChartData<"line"> = {
    labels: props.labels,
    datasets: [
      { label: "목표 누적 지출", data: props.planCumSpend, borderColor: gray, borderDash: [5, 4], pointRadius: 0, borderWidth: 1.5, fill: false, tension: 0.15 },
      { label: "실측 누적 지출", data: props.actualCumSpend as number[], borderColor: blue, backgroundColor: blueFill, pointRadius: 0, borderWidth: 2, fill: true, tension: 0.15, spanGaps: false },
    ],
  };

  // 4) 일별 지출·CPA — 기준선(4,700/6,000/6,500) 밴드 플러그인 (CPA 축 y1 기준)
  const bandLines: Plugin<"line"> = useMemo(
    () => ({
      id: "cpaBands",
      afterDraw(chart) {
        const yScale = (chart.scales.y1 ?? chart.scales.y) as any;
        if (!yScale) return;
        const { left, right } = chart.chartArea;
        const ctx = chart.ctx;
        const lines = [
          { y: props.cpaBands.green, color: green, label: "그린" },
          { y: props.cpaBands.yellow, color: yellow, label: "동결" },
          { y: props.cpaBands.freeze, color: red, label: "캡" },
        ];
        ctx.save();
        for (const l of lines) {
          const py = yScale.getPixelForValue(l.y);
          if (py < chart.chartArea.top || py > chart.chartArea.bottom) continue;
          ctx.strokeStyle = l.color;
          ctx.setLineDash([3, 3]);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(left, py);
          ctx.lineTo(right, py);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = l.color;
          ctx.font = "9px sans-serif";
          ctx.textAlign = "right";
          ctx.fillText(`${l.label} ${l.y.toLocaleString()}`, right - 2, py - 3);
        }
        ctx.restore();
      },
    }),
    [props.cpaBands, green, yellow, red]
  );

  // 지출 바(좌축) + CPA 라인(우축) 콤보 — 레퍼런스의 "일자별 광고비·CPL" 방식
  const effData: ChartData<any> = {
    labels: props.labels,
    datasets: [
      { type: "bar" as const, label: "계획 일예산", data: props.planSpendDaily, backgroundColor: gray, borderRadius: 3, yAxisID: "y", order: 4 },
      { type: "bar" as const, label: "일별 지출", data: props.spendDaily as number[], backgroundColor: blueFill, borderColor: blue, borderWidth: 1, borderRadius: 3, yAxisID: "y", order: 3 },
      { type: "line" as const, label: "일 CPA", data: props.cpaDaily as number[], borderColor: gray, pointBackgroundColor: gray, pointRadius: 2, borderWidth: 1, borderDash: [3, 3], tension: 0.2, spanGaps: false, yAxisID: "y1", order: 2 },
      { type: "line" as const, label: "3일 이동 CPA", data: props.cpaRolling as number[], borderColor: orange, pointRadius: 0, borderWidth: 2.5, tension: 0.25, spanGaps: false, yAxisID: "y1", order: 1 },
    ],
  };
  const effOptions: ChartOptions<any> = {
    ...baseOptions(moneyTick, won),
    scales: {
      x: { ticks: { color: text, font: { size: 10 }, maxRotation: 0, autoSkip: true }, grid: { color: grid } },
      y: {
        position: "left",
        ticks: { color: text, font: { size: 9 }, callback: (v: any) => moneyTick(Number(v)) },
        grid: { color: grid },
        beginAtZero: true,
        ...(hasSpend ? {} : { suggestedMax: planSpendMax }),
      },
      y1: {
        position: "right",
        ticks: { color: text, font: { size: 9 }, callback: (v: any) => moneyTick(Number(v)) },
        grid: { drawOnChartArea: false },
        beginAtZero: true,
        // CPA 축: 신호등 밴드(그린~캡)가 항상 보이도록 상한을 캡×1.4 로 고정.
        // 실측이 없어도 기준선이 그려지고, 초기 학습구간에 튄 값이 축을 망가뜨리지도 않는다.
        max: Math.round(props.cpaBands.freeze * 1.4),
        ...(hasCpa ? {} : { min: 0 }),
      },
    },
  };

  // 3) 누적 알림 실측 vs 목표
  const leadsData: ChartData<"line"> = {
    labels: props.labels,
    datasets: [
      { label: "목표 누적 알림", data: props.planCumLeads, borderColor: gray, borderDash: [5, 4], pointRadius: 0, borderWidth: 1.5, fill: false, tension: 0.15 },
      { label: "실측 누적 알림", data: props.actualCumLeads as number[], borderColor: blue, backgroundColor: blueFill, pointRadius: 0, borderWidth: 2, fill: true, tension: 0.15, spanGaps: false },
    ],
  };

  const BandNote = () =>
    props.liveMarkers.length ? (
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
        {props.liveLabel}
      </span>
    ) : null;

  const Head = ({ h }: { h: [string, string] }) => (
    <div className="chead">
      <span className="cv">{h[0]}</span>
      <span className="cs">{h[1]}</span>
    </div>
  );

  return (
    <div className="chartgrid">
      <div className="card cchart">
        <div className="section-title">일별 알림 — 계획 vs 실측<BandNote /></div>
        <Head h={props.headers.daily} />
        <div className="chart-box">
          <Bar data={barData} options={baseOptions()} plugins={[webinarMarker]} />
        </div>
      </div>
      <div className="card cchart">
        <div className="section-title">일별 지출 · CPA — 기준선 밴드</div>
        <Head h={props.headers.eff} />
        <div className="chart-box">
          <Line data={effData} options={effOptions} plugins={[bandLines]} />
        </div>
      </div>
      <div className="card cchart">
        <div className="section-title">누적 지출 — 실측 vs 목표<BandNote /></div>
        <Head h={props.headers.cumSpend} />
        <div className="chart-box">
          <Line data={spendData} options={baseOptions(moneyTick, won)} plugins={[webinarMarker]} />
        </div>
      </div>
      <div className="card cchart">
        <div className="section-title">누적 알림신청 — 실측 vs 목표<BandNote /></div>
        <Head h={props.headers.cumLeads} />
        <div className="chart-box">
          <Line data={leadsData} options={baseOptions()} plugins={[webinarMarker]} />
        </div>
      </div>
    </div>
  );
}
