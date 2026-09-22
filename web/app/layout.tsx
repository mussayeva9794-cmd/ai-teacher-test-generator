import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Teacher | Оценивание без лишней работы",
  description: "Создавайте тесты, делитесь ими с учениками и получайте результаты сразу после сдачи.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body>{children}</body></html>;
}
