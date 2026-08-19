// 표시용 포맷터. 계산은 하지 않는다(파생값은 metrics.ts).

export function won(n: number | null | undefined, opts: { sign?: boolean } = {}): string {
  if (n === null || n === undefined || !isFinite(n)) return "—";
  const rounded = Math.round(n);
  const sign = opts.sign && rounded > 0 ? "+" : "";
  return `${sign}₩${rounded.toLocaleString("ko-KR")}`;
}

// 만원 단위 (지출 등 큰 금액 요약용)
export function manwon(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || !isFinite(n)) return "—";
  return `${(n / 10000).toLocaleString("ko-KR", { maximumFractionDigits: digits })}만`;
}

// 억 단위 (기대수익 밴드용)
export function eok(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !isFinite(n)) return "—";
  return `${(n / 100000000).toLocaleString("ko-KR", { maximumFractionDigits: digits, minimumFractionDigits: digits })}억`;
}

// 금액 자동 단위: 1억 이상 → "1.50억", 미만 → "3,270만"
export function money(n: number | null | undefined): string {
  if (n === null || n === undefined || !isFinite(n)) return "—";
  return Math.abs(n) >= 100000000 ? eok(n) : manwon(n);
}

export function num(n: number | null | undefined, opts: { sign?: boolean } = {}): string {
  if (n === null || n === undefined || !isFinite(n)) return "—";
  const rounded = Math.round(n);
  const sign = opts.sign && rounded > 0 ? "+" : "";
  return `${sign}${rounded.toLocaleString("ko-KR")}`;
}

export function pct(n: number | null | undefined, digits = 1, opts: { sign?: boolean } = {}): string {
  if (n === null || n === undefined || !isFinite(n)) return "—";
  const sign = opts.sign && n > 0 ? "+" : "";
  return `${sign}${n.toLocaleString("ko-KR", { maximumFractionDigits: digits, minimumFractionDigits: digits })}%`;
}

// "8/12" 형태
export function shortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${parseInt(m, 10)}/${parseInt(d, 10)}`;
}

// "2026-08-12 (수)" 형태 — 요일은 UTC 기준 계산(타임존 영향 최소화)
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
export function longDate(iso: string): string {
  const dt = new Date(`${iso}T00:00:00+09:00`);
  return `${iso} (${WEEKDAYS[dt.getDay()]})`;
}
