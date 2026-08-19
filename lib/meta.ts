// Meta Graph API 클라이언트 (서버 전용). 토큰은 환경변수에서만 읽는다.
// 절대 클라이언트로 내보내지 않는다. 로그에 토큰을 남기지 않는다.

import "server-only";
import { todayKST, addDays, dayIndex } from "./metrics";

const GRAPH = "https://graph.facebook.com/v21.0";

export interface MetaDailyRow {
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpm: number;
  frequency: number;
  openEvents: number;
}

export interface MetaAdsetRow {
  date: string;
  adsetId: string;
  name: string;
  campaignId: string;
  spend: number;
  impressions: number;
  clicks: number;
  openEvents: number;
}

export interface MetaFetchResult {
  daily: MetaDailyRow[];
  adsets: MetaAdsetRow[];
  discoveredActionTypes: string[]; // 응답에서 관측된 모든 action_type (매핑 확정용)
  openEventActionType: string | null;
}

interface MetaConfig {
  token: string;
  adAccountId: string;
  campaignIds: string[];
  openEventOverride?: string;
}

export function readMetaConfig(): MetaConfig {
  // CLI/셸로 등록된 env 에 BOM(U+FEFF)·개행이 섞일 수 있어 전부 트림한다
  const token = (process.env.META_ACCESS_TOKEN || "").trim();
  const adAccountId = (process.env.META_AD_ACCOUNT_ID || "").trim();
  const campaignIds = (process.env.META_CAMPAIGN_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!token) throw new Error("META_ACCESS_TOKEN 환경변수가 없습니다.");
  if (!adAccountId) throw new Error("META_AD_ACCOUNT_ID 환경변수가 없습니다.");
  if (!campaignIds.length) throw new Error("META_CAMPAIGN_IDS 환경변수가 없습니다.");
  const openEventOverride = (process.env.META_OPENEVENT_ACTION_TYPE || "").trim() || undefined;
  return { token, adAccountId, campaignIds, openEventOverride };
}

async function graphGet(path: string, params: Record<string, string>, token: string): Promise<any> {
  const url = new URL(`${GRAPH}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("access_token", token);
  const res = await fetch(url.toString(), { cache: "no-store" });
  const json = await res.json();
  if (!res.ok || json.error) {
    // 토큰이 URL 에 있으므로 메시지에 URL 을 넣지 않는다.
    const e = json.error || {};
    throw new Error(
      `Meta API 오류 (${res.status}): ${e.message || "unknown"}${e.error_user_msg ? " — " + e.error_user_msg : ""}${e.code ? ` [code ${e.code}${e.error_subcode ? "/" + e.error_subcode : ""}]` : ""}`
    );
  }
  return json;
}

// openEvent 후보 action_type 목록을 만든다.
// 주의: insights 의 actions 에는 사람이 읽는 이름이 아니라 `offsite_conversion.custom.<숫자ID>` 로 온다.
// 따라서 custom_conversions 에서 name==='openEvent' 인 ID 해석이 1순위이고, env override 는 보조 후보다.
async function resolveOpenEventTypes(cfg: MetaConfig): Promise<string[]> {
  const candidates: string[] = [];
  try {
    const json = await graphGet(
      `act_${cfg.adAccountId}/custom_conversions`,
      { fields: "id,name", limit: "200" },
      cfg.token
    );
    for (const c of json.data || []) {
      if (typeof c.name === "string" && c.name.toLowerCase() === "openevent" && c.id) {
        candidates.push(`offsite_conversion.custom.${c.id}`);
      }
    }
  } catch {
    // custom_conversions 접근 실패 시 override/이름 매칭으로 폴백
  }
  if (cfg.openEventOverride) candidates.push(cfg.openEventOverride);
  return candidates;
}

// openEvent 는 픽셀 "커스텀 이벤트"라 custom_conversion 이 아니다 (계정 커스텀 전환 목록에 없음 확인).
// 커스텀 이벤트는 insights 의 `conversions` 필드에 `offsite_conversion.fb_pixel_custom.openEvent` 로 오고,
// `actions` 에는 개별 노출 없이 fb_pixel_custom 합계만 있다. 따라서 conversions 필드가 1순위.
function extractOpenEvents(
  row: { actions?: any[]; conversions?: any[] },
  openEventTypes: string[],
  discovered: Set<string>
): number {
  const scan = (list: any[] | undefined, tag: string): { exact: number | null; byName: number | null } => {
    let exact: number | null = null;
    let byName: number | null = null;
    if (!Array.isArray(list)) return { exact, byName };
    for (const a of list) {
      const t = a?.action_type;
      if (typeof t !== "string") continue;
      discovered.add(tag + t);
      const v = Number(a.value) || 0;
      if (exact === null && openEventTypes.includes(t)) exact = v;
      if (byName === null && t.toLowerCase().includes("openevent")) byName = v;
    }
    return { exact, byName };
  };
  // 1) conversions 필드 (커스텀 이벤트가 개별 노출되는 곳)
  const c = scan(row.conversions, "conv:");
  if (c.exact !== null) return c.exact;
  if (c.byName !== null) return c.byName;
  // 2) actions 필드 (커스텀 전환 custom.<id> 형태 대비)
  const a = scan(row.actions, "act:");
  if (a.exact !== null) return a.exact;
  if (a.byName !== null) return a.byName;
  // 매칭 실패 시 0. (주의: offsite_conversion.fb_pixel_custom 합계는 다른 이벤트까지 섞여
  // 과대집계되므로 절대 폴백으로 쓰지 않는다 — 7/31 351→1277 사고 원인)
  return 0;
}

const INSIGHT_FIELDS = "spend,impressions,clicks,ctr,cpm,frequency,actions,conversions,campaign_id";

export async function fetchMetaRange(sinceIso: string, untilIso: string): Promise<MetaFetchResult> {
  const cfg = readMetaConfig();
  const openEventTypes = await resolveOpenEventTypes(cfg);
  const discovered = new Set<string>();
  const timeRange = JSON.stringify({ since: sinceIso, until: untilIso });
  const filtering = JSON.stringify([
    { field: "campaign.id", operator: "IN", value: cfg.campaignIds },
  ]);

  // ── 캠페인 레벨 일별 ──
  const campJson = await graphGet(
    `act_${cfg.adAccountId}/insights`,
    {
      level: "campaign",
      time_increment: "1",
      time_range: timeRange,
      filtering,
      fields: INSIGHT_FIELDS,
      limit: "500",
    },
    cfg.token
  );

  // 날짜별로 2개 캠페인 합산
  const byDate = new Map<string, { spend: number; impressions: number; clicks: number; openEvents: number; freqW: number }>();
  for (const row of campJson.data || []) {
    const date = row.date_start;
    const spend = Number(row.spend) || 0;
    const impressions = Number(row.impressions) || 0;
    const clicks = Number(row.clicks) || 0;
    const frequency = Number(row.frequency) || 0;
    const openEvents = extractOpenEvents(row, openEventTypes, discovered);
    const cur = byDate.get(date) || { spend: 0, impressions: 0, clicks: 0, openEvents: 0, freqW: 0 };
    cur.spend += spend;
    cur.impressions += impressions;
    cur.clicks += clicks;
    cur.openEvents += openEvents;
    cur.freqW += frequency * impressions; // 노출 가중 빈도
    byDate.set(date, cur);
  }

  const daily: MetaDailyRow[] = [...byDate.entries()]
    .map(([date, v]) => ({
      date,
      spend: Math.round(v.spend),
      impressions: v.impressions,
      clicks: v.clicks,
      ctr: v.impressions ? Number(((v.clicks / v.impressions) * 100).toFixed(2)) : 0,
      cpm: v.impressions ? Math.round((v.spend / v.impressions) * 1000) : 0,
      frequency: v.impressions ? Number((v.freqW / v.impressions).toFixed(2)) : 0,
      openEvents: v.openEvents,
    }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  // ── 세트 레벨 일별 ──
  const adsetJson = await graphGet(
    `act_${cfg.adAccountId}/insights`,
    {
      level: "adset",
      time_increment: "1",
      time_range: timeRange,
      filtering,
      fields: INSIGHT_FIELDS + ",adset_id,adset_name",
      limit: "500",
    },
    cfg.token
  );

  const adsets: MetaAdsetRow[] = (adsetJson.data || []).map((row: any) => ({
    date: row.date_start,
    adsetId: row.adset_id,
    name: row.adset_name,
    campaignId: row.campaign_id,
    spend: Math.round(Number(row.spend) || 0),
    impressions: Number(row.impressions) || 0,
    clicks: Number(row.clicks) || 0,
    openEvents: extractOpenEvents(row, openEventTypes, discovered),
  }));

  return {
    daily,
    adsets,
    discoveredActionTypes: [...discovered].sort(),
    openEventActionType: openEventTypes[0] ?? null,
  };
}

// ── 소재(광고) 성과 + 썸네일 ────────────────────────────────────
export interface CreativePerfMetrics {
  spend: number; impressions: number; clicks: number; ctr: number; openEvents: number;
}
export interface CreativePerfItem {
  creativeId: string; adId: string; name: string; campaignId: string;
  status: string; objectType: string; thumb: string | null;
  videoId: string | null; videoUrl: string | null; videoSrc: string | null;
  latest: CreativePerfMetrics | null; cumulative: CreativePerfMetrics | null;
}
export interface CreativePerfResult {
  latestDate: string; cumulativeFrom: string; cumulativeTo: string; items: CreativePerfItem[];
}

function metricsFromRow(row: any, openEventTypes: string[], discovered: Set<string>): CreativePerfMetrics {
  const impressions = Number(row.impressions) || 0;
  const clicks = Number(row.clicks) || 0;
  const spend = Math.round(Number(row.spend) || 0);
  return {
    spend,
    impressions,
    clicks,
    ctr: impressions ? Number(((clicks / impressions) * 100).toFixed(2)) : 0,
    openEvents: extractOpenEvents(row, openEventTypes, discovered),
  };
}

export async function fetchCreativePerformance(
  latestDate: string,
  cumFrom: string,
  cumTo: string,
  topN = 100
): Promise<CreativePerfResult> {
  const cfg = readMetaConfig();
  const openEventTypes = await resolveOpenEventTypes(cfg);
  const discovered = new Set<string>();
  // 프로덕션 검증된 패턴(fetchTestingAds 와 동일): /ads 엣지 + campaign.id 필터 +
  // insights 는 별도 호출 대신 **필드 확장 + .as() 별칭**으로 한 번에 (별도 ad-level insights 필터가 빈 결과를 내는 사고 방지)
  const adsFiltering = JSON.stringify([{ field: "campaign.id", operator: "IN", value: cfg.campaignIds }]);

  const adsJson = await graphGet(
    `act_${cfg.adAccountId}/ads`,
    {
      fields:
        `id,name,campaign_id,effective_status,` +
        `creative.thumbnail_width(512).thumbnail_height(512){id,object_type,thumbnail_url,image_url,video_id},` +
        `insights.time_range({"since":"${latestDate}","until":"${latestDate}"}).as(insLatest){spend,impressions,clicks,actions,conversions},` +
        `insights.time_range({"since":"${cumFrom}","until":"${cumTo}"}).as(insCum){spend,impressions,clicks,actions,conversions}`,
      filtering: adsFiltering,
      limit: "400",
    },
    cfg.token
  );
  const ads = new Map<
    string,
    {
      name: string; status: string; campaignId: string; creativeId: string; objectType: string;
      thumb: string | null; videoId: string | null;
      latest: CreativePerfMetrics | null; cumulative: CreativePerfMetrics | null;
    }
  >();
  for (const a of adsJson.data || []) {
    const cr = a.creative || {};
    const objectType = cr.object_type || "";
    const thumb = objectType === "SHARE" ? cr.image_url || cr.thumbnail_url || null : cr.thumbnail_url || cr.image_url || null;
    const insL = a.insLatest?.data?.[0] ?? null;
    const insC = a.insCum?.data?.[0] ?? null;
    ads.set(a.id, {
      name: a.name,
      status: a.effective_status,
      campaignId: a.campaign_id,
      creativeId: cr.id || "",
      objectType,
      thumb: thumb || null,
      videoId: cr.video_id || null,
      latest: insL ? metricsFromRow(insL, openEventTypes, discovered) : null,
      cumulative: insC ? metricsFromRow(insC, openEventTypes, discovered) : null,
    });
  }

  // 영상 소재: source(원본 mp4)·permalink·picture 조회 — 권한상 source 가 없을 수 있으므로 실패 허용
  const videoIds = [...new Set([...ads.values()].map((a) => a.videoId).filter(Boolean))] as string[];
  const videoInfo = new Map<string, { src: string | null; url: string | null; picture: string | null }>();
  if (videoIds.length) {
    try {
      const vjson = await graphGet("", { ids: videoIds.join(","), fields: "source,permalink_url,picture" }, cfg.token);
      for (const vid of videoIds) {
        const v = vjson[vid];
        if (!v) continue;
        videoInfo.set(vid, {
          src: v.source || null,
          url: v.permalink_url ? `https://www.facebook.com${v.permalink_url}` : null,
          picture: v.picture || null,
        });
      }
    } catch {
      // source 접근 불가 시 스킵 (썸네일 폴백)
    }
  }

  const items: CreativePerfItem[] = [];
  for (const [adId, meta] of ads.entries()) {
    const cumulative = meta.cumulative;
    const latest = meta.latest;
    if (!cumulative || cumulative.spend <= 0) continue; // 지출 있는 소재만
    const vi = meta.videoId ? videoInfo.get(meta.videoId) : undefined;
    // 영상은 creative 썸네일이 저해상도인 경우가 있어 video picture 를 우선 폴백으로 쓴다
    const thumb = meta.objectType === "VIDEO" ? meta.thumb || vi?.picture || null : meta.thumb;
    items.push({
      creativeId: meta.creativeId, adId, name: meta.name, campaignId: meta.campaignId,
      status: meta.status, objectType: meta.objectType, thumb,
      videoId: meta.videoId, videoUrl: vi?.url ?? null, videoSrc: vi?.src ?? null,
      latest, cumulative,
    });
  }
  items.sort((a, b) => (b.cumulative?.spend ?? 0) - (a.cumulative?.spend ?? 0));

  return { latestDate, cumulativeFrom: cumFrom, cumulativeTo: cumTo, items: items.slice(0, topN) };
}

// ── 🧪 테스트 중 소재 (최근 3일 내 등록된 광고) ─────────────────────
// 썸네일은 핫링크 그대로 사용하고 저장소에 커밋하지 않는다 — 페이지 렌더 시 재조회(캐시 10분).
export interface TestingAd {
  adId: string;
  name: string;
  on: boolean;
  createdDate: string; // KST YYYY-MM-DD
  thumb: string | null;
  isVideo: boolean;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  openEvents: number;
  nameMismatch: boolean; // 소재명 YYMMDD_ 프리픽스 ≠ 등록일
}
export interface TestingAdsResult {
  collectedAt: string; // ISO
  sinceDate: string;
  today: string;
  items: TestingAd[];
}

export async function fetchTestingAds(nowMs: number): Promise<TestingAdsResult> {
  const cfg = readMetaConfig();
  const openEventTypes = await resolveOpenEventTypes(cfg);
  const discovered = new Set<string>();
  const today = todayKST(nowMs);
  const sinceDate = addDays(today, -3);
  // KST 기준 3일 전 00:00 → unix (KST 자정 = UTC-9h)
  const sinceUnix = dayIndex(sinceDate) * 86400 - 9 * 3600;
  const filtering = JSON.stringify([
    { field: "ad.created_time", operator: "GREATER_THAN", value: sinceUnix },
    { field: "campaign.id", operator: "IN", value: cfg.campaignIds },
  ]);
  const json = await graphGet(
    `act_${cfg.adAccountId}/ads`,
    {
      fields:
        `id,name,effective_status,created_time,` +
        `creative.thumbnail_width(512).thumbnail_height(512){thumbnail_url,image_url,object_type},` +
        `insights.time_range({"since":"${sinceDate}","until":"${today}"}){spend,impressions,clicks,ctr,actions,conversions}`,
      filtering,
      limit: "100",
    },
    cfg.token
  );

  const items: TestingAd[] = (json.data || []).map((a: any) => {
    // created_time 예: 2026-08-13T10:22:33+0900 → KST 날짜
    const t = Date.parse(a.created_time);
    const createdDate = todayKST(t);
    const cr = a.creative || {};
    const isVideo = cr.object_type === "VIDEO";
    const thumb = (isVideo ? cr.thumbnail_url : cr.image_url || cr.thumbnail_url) || null;
    const ins = a.insights?.data?.[0] || {};
    const impressions = Number(ins.impressions) || 0;
    const clicks = Number(ins.clicks) || 0;
    const spend = Math.round(Number(ins.spend) || 0);
    // 명명 검증: YYMMDD_ 프리픽스
    let nameMismatch = false;
    const m = /^(\d{6})_/.exec(a.name || "");
    if (m) {
      const y = "20" + m[1].slice(0, 2), mo = m[1].slice(2, 4), dd = m[1].slice(4, 6);
      nameMismatch = `${y}-${mo}-${dd}` !== createdDate;
    }
    return {
      adId: a.id,
      name: a.name,
      on: a.effective_status === "ACTIVE",
      createdDate,
      thumb,
      isVideo,
      spend,
      impressions,
      clicks,
      ctr: impressions ? Number(((clicks / impressions) * 100).toFixed(2)) : 0,
      openEvents: extractOpenEvents(ins, openEventTypes, discovered),
      nameMismatch,
    };
  });
  items.sort((a, b) => (a.createdDate < b.createdDate ? 1 : a.createdDate > b.createdDate ? -1 : b.spend - a.spend));
  return { collectedAt: new Date(nowMs).toISOString(), sinceDate, today, items };
}

// 렌더마다 메타를 때리지 않도록 10분 캐시 (웜 인스턴스 한정)
let testingCache: { ts: number; res: TestingAdsResult } | null = null;
export async function getTestingAdsCached(nowMs: number): Promise<TestingAdsResult | null> {
  if (!process.env.META_ACCESS_TOKEN) return null;
  if (testingCache && nowMs - testingCache.ts < 10 * 60 * 1000) return testingCache.res;
  try {
    const res = await fetchTestingAds(nowMs);
    testingCache = { ts: nowMs, res };
    return res;
  } catch {
    return testingCache?.res ?? null; // 실패 시 이전 캐시라도
  }
}
