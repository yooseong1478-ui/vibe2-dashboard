// 데이터 스키마 — data/vibe2.json 의 구조.
// 원칙: 원본값만 저장. 파생값(CPA·달성률·예상착지 등)은 lib/metrics.ts 에서 계산.

export interface Goals {
  targetLeads: number;        // 목표 알림신청 (30,000)
  stretchLeads?: number;      // 스트레치 목표 (기대수익 섹션 전용)
  totalBudget: number;        // 총 광고예산 (150,000,000)
  aov: number;                // 객단가 (1,000,000 — 9억 ÷ 900건)
  conversionBand: { low: number; high: number }; // 전환율 밴드 (계획 3.0% ~ 1기 실적 6.17%)
  planConversion?: number;    // 계획 기준 전환율 (0.03) — 기대수익 헤드라인
  // 기대수익 시나리오 전환율 (2026-08-20 확정): 1차 웨비나 2.5~3.5%, 최종(2차+이후) 5.0%
  revConv?: { w1Low: number; w1High: number; final: number };
  targetCpa?: number;         // 블렌디드 목표 CPA (5,000)
  cpaHardCap: number;         // CPA 하드캡 (5,500)
  signalGreenMax: number;     // 신호등 그린 상한 (4,500)
  signalYellowMax?: number;   // 🟡 상한 (5,500)
  signalFreezeMax?: number;   // 동결 상한 (6,200, 초과 시 🔴)
  lateCapFrom?: string;       // 이 날짜부터 하드캡 완화 (LIVE 구간 9/8~)
  webinarDate: string;        // 최종 마감일 = 2차 LIVE (2026-09-10)
  startDate: string;          // 메타 집행 시작일 (2026-08-18)
  liveDates?: string[];       // LIVE 일자들 (2026-09-08, 2026-09-10) — 차트 마커
}

export interface PlanDay {
  date: string;       // YYYY-MM-DD
  planSpend: number;  // 일 예산
  planCpa: number;    // 목표 CPA
  planLeads: number;  // 필요/일
}

export interface PlanStep {
  from: string;               // 구간 시작일 (YYYY-MM-DD)
  to: string;                 // 구간 종료일 (포함)
  days: number;               // 일수
  perDay: number;             // 필요/일
  dailyBudget: number;        // 일 예산
  targetCpa: number;          // 목표 CPA
}

export interface DailyRecord {
  date: string;               // YYYY-MM-DD
  leads: number | null;       // 어드민 알림 일별 (수동 원본). 누적은 화면에서 합산. 미입력 시 null.
  openTalkCum: number | null; // 오픈톡방 누적 (수동·선택). 미입력 시 null.
  spend: number | null;       // 지출 (메타, 자동)
  impressions: number | null; // 노출
  clicks: number | null;      // 클릭
  ctr: number | null;         // CTR (%)
  cpm: number | null;         // CPM (원)
  frequency: number | null;   // 빈도
  openEvents: number | null;  // openEvent 픽셀 전환 (메타, 자동)
}

export interface AdsetRecord {
  date: string;
  adsetId: string;
  name: string;
  campaignId: string;
  spend: number;
  impressions: number;
  clicks: number;
  openEvents: number;
}

export interface CreativeMetrics {
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  openEvents: number;
}

export interface CreativeItem {
  creativeId: string;
  adId?: string;
  name: string;
  campaignId: string;
  status: string;       // effective_status (ACTIVE / PAUSED / ADSET_PAUSED ...)
  objectType: string;   // VIDEO / SHARE ...
  thumb: string | null; // 소재 썸네일/이미지 URL (CDN, 토큰 없음, 만료되므로 인제스트마다 갱신)
  videoId?: string | null;  // VIDEO 소재의 영상 ID
  videoUrl?: string | null; // 페이스북 영상 링크(광고주 로그인 시 재생 가능)
  videoSrc?: string | null; // 원본 mp4 (source 필드가 반환될 때만, CDN 서명 URL — 인제스트마다 갱신)
  latest: CreativeMetrics | null;
  cumulative: CreativeMetrics | null;
}

export interface CreativesBlock {
  latestDate: string;
  cumulativeFrom: string;
  cumulativeTo: string;
  items: CreativeItem[];
}

export interface Dataset {
  meta: {
    campaignName: string;
    adAccountId: string;
    campaignIds: string[];
    lastUpdated: string;
    note?: string;
  };
  goals: Goals;
  planBase: { asOf: string; leads: number; spend: number };
  plan: PlanStep[];        // (구) 스텝 플랜 — 8/12 이전 과거 구간 차트용으로 유지
  planDaily?: PlanDay[];   // 확정 일별 플랜 (8/13~) — 이후 구간은 이걸 사용
  daily: DailyRecord[];
  adsets: AdsetRecord[];
  creatives?: CreativesBlock;
}
