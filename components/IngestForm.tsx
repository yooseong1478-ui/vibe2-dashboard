"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

function todayKST(): string {
  const dt = new Date(Date.now() + 9 * 3600 * 1000);
  return dt.toISOString().slice(0, 10);
}
const won = (n: number | null | undefined) =>
  n == null || !isFinite(n) ? "—" : "₩" + Math.round(n).toLocaleString("ko-KR");

export interface EditRow {
  date: string;
  leads: number | null;
  openTalkCum: number | null;
  spend: number | null;
}

interface Props {
  prevCum: number | null;     // 최신 완결일까지 누적(파생)
  prevDate: string | null;
  rows: EditRow[];            // 수기 수정용 최근 일자들 (과거→최신)
}

interface Summary {
  date: string;
  dailyLeadDelta: number | null;
  dayCpaAdmin: number | null;
  dayOpenEvents: number | null;
  daySpend: number | null;
  rolling3Cpa: number | null;
  signal: { level: string; label: string; reason: string } | null;
}

export default function IngestForm({ prevCum, prevDate, rows }: Props) {
  const router = useRouter();
  const [date, setDate] = useState(todayKST());
  const [leads, setLeads] = useState("");
  const [openTalkCum, setOpenTalkCum] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [needConfirm, setNeedConfirm] = useState(false);
  const [refreshAll, setRefreshAll] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [meta, setMeta] = useState<{ committed: boolean; wroteLocal: boolean; actionTypes: string[]; openEventType: string | null } | null>(null);

  // 수기 수정 모드
  const [showEdit, setShowEdit] = useState(false);
  const [draft, setDraft] = useState<Record<string, { leads: string; openTalk: string }>>({});
  const [editBusy, setEditBusy] = useState(false);
  const [editMsg, setEditMsg] = useState<string | null>(null);

  const projectedCum = useMemo(() => {
    const n = Number(leads);
    if (leads === "" || !isFinite(n)) return null;
    return (prevCum ?? 0) + n;
  }, [leads, prevCum]);

  async function save(confirmSurge: boolean) {
    setBusy(true); setError(null); setWarnings([]);
    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, leads: Number(leads), openTalkCum: openTalkCum === "" ? null : Number(openTalkCum), confirmSurge, refreshAll }),
      });
      const json = await res.json();
      if (!res.ok) {
        if (json.needConfirm) { setNeedConfirm(true); setError(json.error || "확인이 필요합니다."); }
        else setError(json.error || `저장 실패 (${res.status})`);
        setBusy(false);
        return;
      }
      setSummary(json.summary);
      setWarnings([
        ...(json.warnings || []),
        ...(json.spendChangeWarning ? [json.spendChangeWarning] : []),
        ...(json.creativeRefreshError ? [json.creativeRefreshError] : []),
      ]);
      setMeta({ committed: json.committed, wroteLocal: json.wroteLocal, actionTypes: json.discoveredActionTypes || [], openEventType: json.openEventActionType });
      setNeedConfirm(false);
      router.refresh();
    } catch (e: any) {
      setError(e?.message || "네트워크 오류");
    }
    setBusy(false);
  }

  function draftFor(r: EditRow) {
    return draft[r.date] ?? { leads: r.leads == null ? "" : String(r.leads), openTalk: r.openTalkCum == null ? "" : String(r.openTalkCum) };
  }

  async function saveEdits() {
    setEditBusy(true); setEditMsg(null);
    const edits: any[] = [];
    for (const r of rows) {
      const d = draft[r.date];
      if (!d) continue;
      const newLeads = d.leads === "" ? null : Number(d.leads);
      const newOt = d.openTalk === "" ? null : Number(d.openTalk);
      if (newLeads !== r.leads || newOt !== r.openTalkCum) {
        edits.push({ date: r.date, leads: newLeads, openTalkCum: newOt });
      }
    }
    if (!edits.length) { setEditMsg("변경 사항이 없습니다."); setEditBusy(false); return; }
    try {
      const res = await fetch("/api/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ edits }),
      });
      const json = await res.json();
      if (!res.ok) setEditMsg(`오류: ${json.error}`);
      else { setEditMsg(`저장됨 (${json.changed?.length ?? edits.length}건${json.committed ? " · 커밋됨" : ""})`); setDraft({}); router.refresh(); }
    } catch (e: any) {
      setEditMsg(`오류: ${e?.message || "네트워크"}`);
    }
    setEditBusy(false);
  }

  async function logout() {
    await fetch("/api/auth", { method: "DELETE" });
    router.refresh();
  }

  if (summary) {
    return (
      <div>
        <div className="banner ok">저장 완료 · {meta?.committed ? "GitHub 커밋됨(재배포 진행)" : meta?.wroteLocal ? "로컬 저장됨" : "저장됨"}</div>
        <div className="card">
          <div className="result-line"><span>대상일</span><span>{summary.date}</span></div>
          <div className="result-line"><span>오늘 알림 (일별)</span><span>{summary.dailyLeadDelta == null ? "—" : `+${summary.dailyLeadDelta.toLocaleString()}명`}</span></div>
          <div className="result-line"><span>일 지출</span><span>{won(summary.daySpend)}</span></div>
          <div className="result-line"><span>일 CPA (어드민)</span><span>{won(summary.dayCpaAdmin)}</span></div>
          <div className="result-line"><span>일 openEvent</span><span>{summary.dayOpenEvents ?? "—"}건</span></div>
          <div className="result-line"><span>3일 이동 CPA</span><span>{won(summary.rolling3Cpa)}</span></div>
          <div className="result-line"><span>신호등</span><span>{signalEmoji(summary.signal?.level)} {summary.signal?.label ?? "—"}</span></div>
        </div>
        {warnings.length > 0 && (
          <div className="banner warn" style={{ marginTop: 12 }}>{warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}</div>
        )}
        {meta && (
          <div className="card" style={{ marginTop: 12 }}>
            <div className="result-line"><span>openEvent action_type</span><span style={{ fontSize: 11 }}>{meta.openEventType || "자동 스캔"}</span></div>
          </div>
        )}
        <button className="btn secondary" style={{ marginTop: 14 }} onClick={() => { setSummary(null); setLeads(""); setOpenTalkCum(""); }}>다시 입력</button>
        <div className="footer-links"><a href="/">대시보드에서 확인 →</a></div>
      </div>
    );
  }

  return (
    <div>
      <div className="hint" style={{ marginBottom: 12 }}>
        현재 누적: {prevDate ? `${prevDate}까지 ${prevCum?.toLocaleString()}명` : "없음"}
      </div>
      <div className="field">
        <label>날짜</label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} max={todayKST()} />
      </div>
      <div className="field">
        <label>오늘 알림신청 (일별, 필수)</label>
        <input type="number" inputMode="numeric" value={leads} onChange={(e) => setLeads(e.target.value)} placeholder="예: 274" autoFocus />
        {projectedCum !== null && (
          <div className="hint">누적 자동 계산: <b>{projectedCum.toLocaleString()}명</b> — 어드민 누적과 맞는지 확인하세요</div>
        )}
      </div>
      <div className="field">
        <label>오픈톡방 누적 (선택)</label>
        <input type="number" inputMode="numeric" value={openTalkCum} onChange={(e) => setOpenTalkCum(e.target.value)} placeholder="선택 입력" />
      </div>

      <label className="hint" style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12, cursor: "pointer" }}>
        <input type="checkbox" checked={refreshAll} onChange={(e) => setRefreshAll(e.target.checked)} />
        전체 기간 메타 재수집 (7/29부터 · 매핑 보정/복구용, 평소엔 불필요)
      </label>

      {error && <div className="banner err">{error}</div>}
      {warnings.map((w, i) => <div key={i} className="banner warn">⚠ {w}</div>)}

      {needConfirm ? (
        <div style={{ display: "grid", gap: 8 }}>
          <button className="btn" disabled={busy} onClick={() => save(true)}>{busy ? "저장 중…" : "급증 확인 · 그대로 저장"}</button>
          <button className="btn secondary" disabled={busy} onClick={() => { setNeedConfirm(false); setError(null); }}>취소</button>
        </div>
      ) : (
        <button className="btn" disabled={busy || leads === ""} onClick={() => save(false)}>
          {busy ? "저장 중… (메타 수집·커밋)" : "저장 → 메타 수집 → 커밋"}
        </button>
      )}

      {/* 지난 데이터 수기 수정 */}
      <button className="btn secondary" style={{ marginTop: 12 }} onClick={() => setShowEdit(!showEdit)}>
        {showEdit ? "지난 데이터 수정 닫기" : "지난 데이터 수기 수정"}
      </button>
      {showEdit && (
        <div className="card" style={{ marginTop: 10, padding: 10 }}>
          <div className="hint" style={{ marginBottom: 8 }}>일별 알림·오픈톡만 수정됩니다. 광고 지표는 메타 원본 유지.</div>
          <div className="table-scroll">
            <table>
              <thead><tr><th>날짜</th><th>지출</th><th>알림(일별)</th><th>오픈톡(누적)</th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const d = draftFor(r);
                  return (
                    <tr key={r.date}>
                      <td>{r.date.slice(5)}</td>
                      <td className="mono" style={{ color: "hsl(var(--text-3))" }}>{won(r.spend)}</td>
                      <td><input className="cell-input" type="number" value={d.leads} onChange={(e) => setDraft({ ...draft, [r.date]: { ...d, leads: e.target.value } })} /></td>
                      <td><input className="cell-input" type="number" value={d.openTalk} placeholder="—" onChange={(e) => setDraft({ ...draft, [r.date]: { ...d, openTalk: e.target.value } })} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {editMsg && <div className="hint" style={{ marginTop: 8 }}>{editMsg}</div>}
          <button className="btn" style={{ marginTop: 10 }} disabled={editBusy} onClick={saveEdits}>
            {editBusy ? "저장 중…" : "수정 사항 저장 · 커밋"}
          </button>
        </div>
      )}

      <div className="footer-links">
        <button onClick={logout} style={{ background: "none", border: "none", color: "hsl(var(--text-3))", cursor: "pointer" }}>로그아웃</button>
      </div>
    </div>
  );
}

function signalEmoji(level?: string) {
  return level === "green" ? "🟢" : level === "yellow" ? "🟡" : level === "red" ? "🔴" : "⚪";
}
