import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Морской маршрут",
  description: "Учёт перевозок и аналитика для руководителя",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0a1a45",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
