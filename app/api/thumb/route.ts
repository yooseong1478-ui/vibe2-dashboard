import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 소재 썸네일 프록시 — fbcdn 썸네일 URL 은 서명·만료가 있어 vibe2.json 에 저장한 값은 며칠 뒤 403 이 난다.
// 그래서 클라이언트는 항상 /api/thumb?adId= 를 부르고, 서버가 그때그때 새 URL 을 받아 302 로 넘긴다.
// (previews 와 같은 이유로 인증은 걸지 않는다 — 토큰은 서버에만, 이 계정 광고만 응답.)
const cache = new Map<string, { ts: number; url: string }>();
const TTL = 6 * 60 * 60 * 1000; // fbcdn URL 은 대체로 수일 유효 — 6시간이면 안전

export async function GET(req: Request) {
  const adId = new URL(req.url).searchParams.get("adId") ?? "";
  if (!/^\d{5,25}$/.test(adId)) {
    return NextResponse.json({ ok: false, error: "adId 형식 오류" }, { status: 400 });
  }
  const hit = cache.get(adId);
  if (hit && Date.now() - hit.ts < TTL) return redirect(hit.url);

  const token = (process.env.META_ACCESS_TOKEN || "").trim();
  if (!token) return NextResponse.json({ ok: false, error: "META_ACCESS_TOKEN 없음" }, { status: 500 });

  const url = new URL(`https://graph.facebook.com/v21.0/${adId}`);
  url.searchParams.set(
    "fields",
    "creative.thumbnail_width(512).thumbnail_height(512){thumbnail_url,image_url,object_type}"
  );
  url.searchParams.set("access_token", token);
  const res = await fetch(url.toString(), { next: { revalidate: 6 * 60 * 60 } });
  const json = await res.json().catch(() => null);
  const cr = json?.creative;
  if (!res.ok || !cr) {
    // 404 → <img onError> 가 플레이스홀더로 폴백한다
    return NextResponse.json({ ok: false, error: json?.error?.message ?? "썸네일 조회 실패" }, { status: 404 });
  }
  const isVideo = cr.object_type === "VIDEO";
  const thumb: string | null = (isVideo ? cr.thumbnail_url : cr.image_url || cr.thumbnail_url) || cr.thumbnail_url || null;
  if (!thumb) return NextResponse.json({ ok: false, error: "썸네일 없음" }, { status: 404 });

  cache.set(adId, { ts: Date.now(), url: thumb });
  return redirect(thumb);
}

function redirect(to: string) {
  return new NextResponse(null, {
    status: 302,
    headers: {
      Location: to,
      // 브라우저·CDN 이 1시간 재사용 — 그 안에 fbcdn 이 만료될 일은 없다
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
