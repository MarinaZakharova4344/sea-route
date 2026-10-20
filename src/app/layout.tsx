import type { ReactNode } from "react";
import RegisterSW from "@/components/RegisterSW";
import "./globals.css";

export const metadata = {
  title: "Морской маршрут",
  description: "Учёт перевозок и аналитика для руководителя",
  applicationName: "Морской маршрут",
  icons: {
    icon: [{ url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  appleWebApp: { capable: true, title: "Маршрут", statusBarStyle: "black-translucent" as const },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover" as const,
  themeColor: "#0a1a45",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <head>
        {process.env.NODE_ENV !== "production" && (
          // Только для режима разработки: Safari на iPhone бросает TypeError в performance.measure, который вызывает сам React.
          <script dangerouslySetInnerHTML={{ __html: "(function(){var m=window.performance&&performance.measure;if(!m)return;performance.measure=function(){try{return m.apply(this,arguments)}catch(e){}}})()" }} />
        )}
      </head>
      <body>
        {children}
        <RegisterSW />
      </body>
    </html>
  );
}
