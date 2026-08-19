import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "바이브코딩 2기 현황판",
  description: "바이브코딩 2기 알림신청 캠페인 실시간 현황 (목표 30,000명)",
  robots: { index: false, follow: false, nocache: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b0d12",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // 아래 인라인 스크립트가 하이드레이션 전에 data-theme 을 붙이므로
    // html 태그의 속성 불일치 경고는 의도된 것이다.
    <html lang="ko" suppressHydrationWarning>
      <head>
        <meta name="robots" content="noindex, nofollow" />
        <link
          rel="stylesheet"
          as="style"
          // Pretendard 다이나믹 서브셋 (기존 대시보드와 동일 폰트)
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
        {/* 테마를 페인트 전에 적용 — 새로고침 때 라이트→다크 깜빡임 방지 */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("theme");if(t==="dark"||t==="light")document.documentElement.setAttribute("data-theme",t);}catch(e){}`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
