/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  // Значок Next.js в углу виден только при разработке; убираем его, чтобы он не мешал интерфейсу.
  devIndicators: false,
  // Открытие dev-сервера с телефона по адресу в локальной сети (например, http://192.168.1.69:3000).
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*"],
  async headers() {
    return [
      {
        // service worker всегда проверяется заново, иначе обновления приложения не дойдут до устройств
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
