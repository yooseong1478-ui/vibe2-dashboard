import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { getDataset } from "@/lib/dataStore";
import { validateInput, runIngest, type IngestInput } from "@/lib/ingest";
import { computeView, deriveDaily, dayIndex } from "@/lib/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await isAuthed())) {
    return NextResponse.json({ ok: false, error: "인증이 필요합니다." }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "잘못된 요청" }, { status: 400 });
  }

  const input: IngestInput = {
    date: String(body?.date ?? ""),
    leads: Number(body?.leads),
    openTalkCum: body?.openTalkCum === "" || body?.openTalkCum == null ? null : Number(body.openTalkCum),
    confirmSurge: Boolean(body?.confirmSurge),
    refreshAll: Boolean(body?.refreshAll),
  };

  const { data, error } = await getDataset();
  if (!data) {
    return NextResponse.json({ ok: false, error: error ?? "데이터 로드 실패" }, { status: 500 });
  }

  const now = Date.now();
  const v = validateInput(data, input, now);
  if (!v.ok) {
    return NextResponse.json(
      { ok: false, needConfirm: !!v.needConfirm, error: v.error, warnings: v.warnings },
      { status: v.needConfirm ? 409 : 400 }
    );
  }

  try {
    const result = await runIngest(data, input, now);

    // 저장에 사용한 next 데이터셋으로 요약 계산
    // (프로덕션에선 커밋만 되고 파일 재읽기는 옛값이므로 반드시 result.dataset 사용)
    const next = result.dataset;
    const view = computeView(next, now);

    // 입력일 기준 일 CPA(어드민) 요약
    const derived = deriveDaily(next.daily);
    const dayRec = derived.find((d) => d.date === input.date);
    const dailyLeadDelta = dayRec?.leads ?? input.leads;
    void dayIndex;

    return NextResponse.json({
      ok: true,
      committed: result.committed,
      wroteLocal: result.wroteLocal,
      updatedDates: result.updatedDates,
      spendChangeWarning: result.spendChangeWarning ?? null,
      creativeRefreshError: result.creativeRefreshError ?? null,
      warnings: v.warnings,
      discoveredActionTypes: result.discoveredActionTypes,
      openEventActionType: result.openEventActionType,
      summary: {
        date: input.date,
        dailyLeadDelta,
        dayCpaAdmin: dayRec?.cpaAdmin ?? null,
        dayOpenEvents: dayRec?.openEvents ?? null,
        daySpend: dayRec?.spend ?? null,
        rolling3Cpa: view?.rolling3Cpa ?? null,
        signal: view ? { level: view.signal.level, label: view.signal.label, reason: view.signal.reason } : null,
      },
    });
  } catch (e: any) {
    // 메타/커밋 실패 원인을 폼에 그대로 전달
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 502 });
  }
}
