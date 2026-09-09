// 소재 썸네일 src — 저장된 fbcdn URL 은 만료되므로 adId 가 있으면 항상 서버 프록시(/api/thumb)를 쓴다.
export function thumbSrc(adId: string | null | undefined, thumb: string | null | undefined): string | null {
  if (adId) return `/api/thumb?adId=${adId}`;
  return thumb ?? null;
}
