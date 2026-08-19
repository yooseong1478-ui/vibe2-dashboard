/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // noindex/nofollow at the edge for the whole app (also set via <meta> in layout)
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

module.exports = nextConfig;
