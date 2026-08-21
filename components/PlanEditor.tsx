"use client";

// 플랜 수동 편집기 — 홈 차트의 계획선·일예산선·신호등 존·페이스 갭 목표가 전부 여기서 나온다.
// 구간 단위(목표 알림·예산·CPA·밴드)로 편집하고 저장하면 GitHub 커밋 → 재배포로 반영된다.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { PlanStep } from "@/lib/types";

interface Row {
  name: string;
  from: string;
  to: string;
  leads: string;      // 구간 목표 알림 (명)
  budgetMan: string;  // 구간 예산 (만원 입력 → 저장 시 ×10,000)
  targetCpa: string;
  green: string;
  yellow: string;
  freeze: string;
}

const days = (from: string, to: string) => {
  const a = Date.parse(from + "T00:00:00Z");
  const b = Date.parse(to + "T00:00:00Z");
  if (!a || !b || b < a) return 0;
  return Math.round((b - a) / 86400000) + 1;
};
const fmt = (n: number) => n.toLocaleString("ko-KR");

export default function PlanEditor({ plan, targetLeads }: { plan: PlanStep[]; targetLeads: number }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(
    plan.map((p) => ({
      name: p.name ?? "",
      from: p.from,
      to: p.to,
      leads: String(p.perDay * p.days),
      budgetMan: String(Math.round((p.dailyBudget * p.days) / 10000)),
      targetCpa: String(p.targetCpa),
      green: String(p.bands?.green ?? ""),
      yellow: String(p.bands?.yellow ?? ""),
      freeze: String(p.bands?.freeze ?? ""),
    }))
  );
  const [goal, setGoal] = useState(String(targetLeads));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const set = (i: number, k: keyof Row, v: string) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));

  const addRow = () => {
    const last = rows[rows.length - 1];
    setRows([...rows, { name: "", from: last?.to ?? "", to: last?.to ?? "", leads: "", budgetMan: "", targetCpa: "", green: last?.green ?? "", yellow: last?.yellow ?? "", freeze: last?.freeze ?? "" }]);
  };
  const delRow = (i: number) => setRows((rs) => rs.filter((_, j) => j !== i));

  const totals = useMemo(() => {
    let l = 0, b = 0;
    for (const r of rows) {
      l += Number(r.leads) || 0;
      b += (Number(r.budgetMan) || 0) * 10000;
    }
    return { leads: l, budget: b, cpa: l ? b / l : 0 };
  }, [rows]);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetLeads: Number(goal),
          plan: rows.map((r) => ({
            name: r.name.trim(),
            from: r.from.trim(),
            to: r.to.trim(),
            leads: Number(r.leads),
            budget: (Number(r.budgetMan) || 0) * 10000,
            targetCpa: Number(r.targetCpa),
            green: Number(r.green),
            yellow: Number(r.yellow),
            freeze: Number(r.freeze),
          })),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMsg({ ok: false, text: json.error || `저장 실패 (${res.status})` });
      } else {
        setMsg({
          ok: true,
          text: `저장 완료 — ${json.summary.steps}구간 · 합계 ${fmt(json.summary.totLeads)}명 / ${fmt(Math.round(json.summary.totBudget / 10000))}만원${json.committed ? " · GitHub 커밋됨 (재배포 후 홈 반영)" : ""}`,
        });
        router.refresh();
      }
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message ?? String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="planedit">
      <summary>📐 플랜 편집 (계획선·신호등 존)</summary>
      <p className="pe-hint">
        홈 추이 차트의 계획선·일예산선·신호등 존·페이스 갭 목표가 전부 이 표에서 계산됩니다.
        구간 값은 일별로 균등 배분되고, 총예산·평균 CPA는 합계로 자동 갱신됩니다.
      </p>

      <div className="field">
        <label>목표 알림신청 (전체)</label>
        <input type="number" value={goal} onChange={(e) => setGoal(e.target.value)} />
      </div>

      {rows.map((r, i) => (
        <div key={i} className="pe-row">
          <div className="pe-head">
            <input className="pe-name" placeholder={`${i + 1}구간 이름`} value={r.name} onChange={(e) => set(i, "name", e.target.value)} />
            <span className="pe-days">{days(r.from, r.to) || "—"}일</span>
            <button className="pe-del" onClick={() => delRow(i)} title="구간 삭제">✕</button>
          </div>
          <div className="pe-grid">
            <label>시작<input type="date" value={r.from} onChange={(e) => set(i, "from", e.target.value)} /></label>
            <label>종료<input type="date" value={r.to} onChange={(e) => set(i, "to", e.target.value)} /></label>
            <label>목표 알림(명)<input type="number" value={r.leads} onChange={(e) => set(i, "leads", e.target.value)} /></label>
            <label>예산(만원)<input type="number" value={r.budgetMan} onChange={(e) => set(i, "budgetMan", e.target.value)} /></label>
            <label>목표 CPA<input type="number" value={r.targetCpa} onChange={(e) => set(i, "targetCpa", e.target.value)} /></label>
            <label>🟢 그린 ≤<input type="number" value={r.green} onChange={(e) => set(i, "green", e.target.value)} /></label>
            <label>🟡 옐로 ≤<input type="number" value={r.yellow} onChange={(e) => set(i, "yellow", e.target.value)} /></label>
            <label>🟠 동결 ≤<input type="number" value={r.freeze} onChange={(e) => set(i, "freeze", e.target.value)} /></label>
          </div>
        </div>
      ))}

      <button className="pe-add" onClick={addRow}>+ 구간 추가</button>

      <div className="pe-total">
        합계 <b>{fmt(totals.leads)}명</b> · <b>{fmt(Math.round(totals.budget / 10000))}만원</b>
        {totals.cpa > 0 && <> · 평균 CPA <b>₩{fmt(Math.round(totals.cpa))}</b></>}
      </div>

      <button className="btn-primary pe-save" onClick={save} disabled={busy}>
        {busy ? "저장 중…" : "플랜 저장"}
      </button>
      {msg && <div className={`banner ${msg.ok ? "ok" : "err"}`}>{msg.text}</div>}
    </details>
  );
}
