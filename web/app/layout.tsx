import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./glass.css";
import "./motion.css";
import "./features.css";
import { I18nProvider } from "./i18n-provider";
import { ServiceWorker } from "./pwa";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return {
    title: t.meta.title, description: t.meta.description,
    // Installed on an iPhone home screen, the app opens without Safari's bars.
    appleWebApp: { capable: true, title: "Mugalim AI", statusBarStyle: "default" },
  };
}

export const viewport: Viewport = { themeColor: "#951122", viewportFit: "cover" };

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const { locale } = await getT();
  return <html lang={locale}><body><I18nProvider initialLocale={locale}>{children}</I18nProvider><ServiceWorker /></body></html>;
}
