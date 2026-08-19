// data/vibe2.json 무결성 검증. 커밋 전 `npm run check:data` 로 실행.
import { readFile } from "fs/promises";
import path from "path";

const P = path.join(process.cwd(), "data", "vibe2.json");

function dayIndex(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

const errors = [];
const warnings = [];

let data;
try {
  data = JSON.parse(await readFile(P, "utf-8"));
} catch (e) {
  console.error("❌ JSON 파싱 실패:", e.message);
  process.exit(1);
}

// 필수 키
for (const k of ["goals", "planBase", "plan", "daily", "adsets"]) {
  if (!(k in data)) errors.push(`필수 키 누락: ${k}`);
}

// daily 정렬/음수/미래 (원본은 일별 leads)
const daily = [...(data.daily || [])].sort((a, b) => dayIndex(a.date) - dayIndex(b.date));
const todayIdx = Math.floor((Date.now() + 9 * 3600 * 1000) / 86400000);
for (const d of daily) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) errors.push(`날짜 형식 오류: ${d.date}`);
  if (dayIndex(d.date) > todayIdx) errors.push(`미래 날짜: ${d.date}`);
  if (d.leads !== null && d.leads !== undefined && d.leads < 0) errors.push(`음수 알림: ${d.date} (${d.leads})`);
  if (d.spend !== null && d.spend !== undefined && d.spend < 0) errors.push(`음수 지출: ${d.date}`);
}

// 날짜 공백 감지(시작일~최신 지출일)
if (daily.length) {
  const withSpend = daily.filter((d) => d.spend != null);
  if (withSpend.length) {
    const first = withSpend[0].date;
    const last = withSpend[withSpend.length - 1].date;
    const have = new Set(daily.map((d) => d.date));
    for (let i = dayIndex(first); i <= dayIndex(last); i++) {
      const iso = new Date(i * 86400000).toISOString().slice(0, 10);
      if (!have.has(iso)) warnings.push(`날짜 공백: ${iso}`);
    }
  }
}

if (warnings.length) warnings.forEach((w) => console.warn("⚠ ", w));
if (errors.length) {
  errors.forEach((e) => console.error("❌", e));
  process.exit(1);
}
console.log(`✅ 검증 통과 — daily ${daily.length}일, adsets ${data.adsets.length}행`);
