// data/vibe2.json 읽기/쓰기 + GitHub 커밋.
// 서버 전용. Vercel 런타임 파일시스템은 읽기전용이므로 저장은 GitHub 커밋으로 한다.

import "server-only";
import { promises as fs } from "fs";
import path from "path";
import type { Dataset } from "./types";

const DATA_PATH = "data/vibe2.json";
const ABS_PATH = path.join(process.cwd(), DATA_PATH);

export interface ReadResult {
  data: Dataset | null;
  error: string | null;
}

// 프로덕션은 GitHub 원본을 우선 읽는다. 번들 파일은 빌드 시점 스냅샷이라,
// 재배포가 끝나기 전 연속 저장 시 직전 저장분(수동 leads)이 유실되는 레이스가 있었다 (8/13 529 유실 사고).
let ghCache: { ts: number; data: Dataset } | null = null;

async function readFromGitHub(): Promise<Dataset | null> {
  const token = (process.env.GITHUB_TOKEN || "").trim();
  const repo = (process.env.GITHUB_REPO || "").trim();
  const branch = (process.env.GITHUB_BRANCH || "main").trim();
  if (!token || !repo) return null;
  if (ghCache && Date.now() - ghCache.ts < 15_000) return ghCache.data;
  const res = await fetch(
    `https://api.github.com/repos/${repo}/contents/${DATA_PATH}?ref=${encodeURIComponent(branch)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.raw+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "vibe2-dashboard",
      },
      cache: "no-store",
    }
  );
  if (!res.ok) return null;
  const data = (await res.json()) as Dataset;
  ghCache = { ts: Date.now(), data };
  return data;
}

export async function getDataset(): Promise<ReadResult> {
  if (process.env.NODE_ENV === "production") {
    try {
      const gh = await readFromGitHub();
      if (gh) return { data: gh, error: null };
    } catch {
      // GitHub 실패 시 번들 파일 폴백
    }
  }
  try {
    const raw = await fs.readFile(ABS_PATH, "utf-8");
    const data = JSON.parse(raw) as Dataset;
    return { data, error: null };
  } catch (e: any) {
    return { data: null, error: `데이터 로드 실패: ${e?.message ?? String(e)}` };
  }
}

// GitHub Contents API 로 파일 커밋(생성/갱신). 성공 시 Vercel 이 자동 재배포한다.
async function githubCommit(content: string, message: string): Promise<{ committed: boolean; sha?: string }> {
  // env 에 섞일 수 있는 BOM·개행 방지 트림
  const token = (process.env.GITHUB_TOKEN || "").trim();
  const repo = (process.env.GITHUB_REPO || "").trim(); // owner/repo
  const branch = (process.env.GITHUB_BRANCH || "main").trim();
  if (!token || !repo) return { committed: false };

  const apiBase = `https://api.github.com/repos/${repo}/contents/${DATA_PATH}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "vibe2-dashboard",
  };

  // 현재 파일 sha 조회(갱신에 필요)
  let sha: string | undefined;
  const getRes = await fetch(`${apiBase}?ref=${encodeURIComponent(branch)}`, { headers, cache: "no-store" });
  if (getRes.ok) {
    const cur = await getRes.json();
    sha = cur.sha;
  } else if (getRes.status !== 404) {
    const t = await getRes.text();
    throw new Error(`GitHub 파일 조회 실패 (${getRes.status}): ${t.slice(0, 200)}`);
  }

  const body = {
    message,
    content: Buffer.from(content, "utf-8").toString("base64"),
    branch,
    ...(sha ? { sha } : {}),
  };
  const putRes = await fetch(apiBase, { method: "PUT", headers, body: JSON.stringify(body), cache: "no-store" });
  if (!putRes.ok) {
    const t = await putRes.text();
    throw new Error(`GitHub 커밋 실패 (${putRes.status}): ${t.slice(0, 200)}`);
  }
  const out = await putRes.json();
  ghCache = null; // 커밋 직후 캐시 무효화 — 다음 읽기는 방금 커밋본
  return { committed: true, sha: out.content?.sha };
}

export interface SaveResult {
  committed: boolean;
  wroteLocal: boolean;
  sha?: string;
}

// 데이터셋 저장: 로컬 dev 는 파일에 직접 쓰고, GitHub 토큰이 있으면 커밋한다.
export async function saveDataset(data: Dataset, message: string): Promise<SaveResult> {
  const content = JSON.stringify(data, null, 2) + "\n";

  let wroteLocal = false;
  // 로컬 개발 환경(파일시스템 쓰기 가능)에서는 즉시 반영
  if (process.env.NODE_ENV !== "production") {
    try {
      await fs.writeFile(ABS_PATH, content, "utf-8");
      wroteLocal = true;
    } catch {
      // 쓰기 불가(읽기전용 FS)면 무시하고 커밋에 의존
    }
  }

  const { committed, sha } = await githubCommit(content, message);
  return { committed, wroteLocal, sha };
}
