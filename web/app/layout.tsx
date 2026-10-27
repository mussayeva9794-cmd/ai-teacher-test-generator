import type { Metadata } from "next";
import "./globals.css";
import "./glass.css";
import "./motion.css";
import "./features.css";
import { I18nProvider } from "./i18n-provider";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t.meta.title, description: t.meta.description };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const { locale } = await getT();
  return <html lang={locale}><body><I18nProvider initialLocale={locale}>{children}</I18nProvider></body></html>;
}
