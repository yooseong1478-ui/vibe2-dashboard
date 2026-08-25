import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 광고 미리보기 iframe — 소재 라이트박스에서 실제 광고(영상 재생 포함)를 임베드한다.
// 이 계정 토큰은 video 노드 접근 권한이 없어(#10) source/permalink 를 못 얻는다 —
// /{ad_id}/previews 는 ads_read 로 가능하므로 이 경로가 유일한 재생 수단이다.
// 인증은 걸지 않는다(대시보드 자체가 내부용 noindex): 토큰은 서버에만 있고,
// 데이터셋에 존재하는 adId 만 허용하므로 임의 광고 조회 프록시로는 못 쓴다.
const cache = new Map<string, { ts: number; body: string }>();
const TTL = 10 * 60 * 1000; // iframe URL 은 서명·만료가 있어 짧게 캐시

export async function GET(req: Request) {
  const adId = new URL(req.url).searchParams.get("adId") ?? "";
  if (!/^\d{5,25}$/.test(adId)) {
    return NextResponse.json({ ok: false, error: "adId 형식 오류" }, { status: 400 });
  }

  // 데이터셋 존재 검증은 하지 않는다 — 테스트 중 소재(등록 3일 내)는 creatives 블록에
  // 아직 없다. 토큰이 접근 가능한 광고(이 계정)만 메타가 응답하므로 프록시 남용 위험은 없다.
  const hit = cache.get(adId);
  if (hit && Date.now() - hit.ts < TTL) {
    return NextResponse.json({ ok: true, body: hit.body, cached: true });
  }

  const token = (process.env.META_ACCESS_TOKEN || "").trim();
  if (!token) return NextResponse.json({ ok: false, error: "META_ACCESS_TOKEN 없음" }, { status: 500 });

  const url = new URL(`https://graph.facebook.com/v21.0/${adId}/previews`);
  url.searchParams.set("ad_format", "MOBILE_FEED_STANDARD");
  url.searchParams.set("access_token", token);
  const res = await fetch(url.toString(), { cache: "no-store" });
  const json = await res.json();
  if (!res.ok || json.error || !json.data?.[0]?.body) {
    return NextResponse.json(
      { ok: false, error: json.error?.message ?? `미리보기 조회 실패 (${res.status})` },
      { status: 502 }
    );
  }
  const body: string = json.data[0].body;
  cache.set(adId, { ts: Date.now(), body });
  return NextResponse.json({ ok: true, body });
}
