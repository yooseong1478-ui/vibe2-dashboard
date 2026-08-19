import { isAuthed } from "@/lib/auth";
import { getDataset } from "@/lib/dataStore";
import { deriveDaily } from "@/lib/metrics";
import AdminLogin from "@/components/AdminLogin";
import IngestForm, { type EditRow } from "@/components/IngestForm";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const authed = await isAuthed();

  if (!authed) {
    return (
      <main className="admin-wrap">
        <div className="header"><h1>현황판 입력</h1></div>
        <AdminLogin />
        <div className="footer-links"><a href="/">← 대시보드</a></div>
      </main>
    );
  }

  const { data } = await getDataset();
  const derived = data ? deriveDaily(data.daily) : [];
  const withLeads = derived.filter((d) => d.leadsCum !== null);
  const last = withLeads.length ? withLeads[withLeads.length - 1] : null;

  // 수기 수정용: 최근 14일 (과거→최신)
  const rows: EditRow[] = derived.slice(-14).map((d) => ({
    date: d.date,
    leads: d.leads,
    openTalkCum: d.openTalkCum,
    spend: d.spend,
  }));

  return (
    <main className="admin-wrap">
      <div className="header"><h1>현황판 입력</h1></div>
      <IngestForm prevCum={last?.leadsCum ?? null} prevDate={last?.date ?? null} rows={rows} />
      <div className="footer-links"><a href="/">← 대시보드</a></div>
    </main>
  );
}
