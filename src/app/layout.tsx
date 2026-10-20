import type { ReactNode } from "react";

export const metadata = {
  title: "Морской маршрут",
  description: "Учёт перевозок и аналитика для руководителя",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
