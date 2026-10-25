"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { browserClient } from "@/lib/supabase";
import { Brand } from "./brand";
import { useT } from "./i18n-provider";
import { LanguageSwitcher } from "./language-switcher";

type Section = "tests" | "classes" | "create" | "account";

const ITEMS: [Section, string][] = [
  ["tests", "/dashboard"],
  ["classes", "/classes"],
  ["create", "/create"],
  ["account", "/account"],
];

/**
 * One teacher menu for every teacher page. `canLeave` lets a page with
 * unsaved edits ask before navigating away.
 */
export function TeacherHeader({ current, canLeave, limited = false }: {
  current?: Section;
  canLeave?: () => boolean;
  /** Signed-in non-teachers see only the sign-out button. */
  limited?: boolean;
}) {
  const router = useRouter();
  const t = useT();
  const guard = (event: React.MouseEvent) => { if (canLeave && !canLeave()) event.preventDefault(); };
  async function signOut() {
    if (canLeave && !canLeave()) return;
    await browserClient().auth.signOut();
    router.replace("/");
  }
  return <header className="topbar teacher-topbar">
    <Brand onClick={guard} compact />
    <LanguageSwitcher />
    <nav className="navlinks" aria-label={t.nav.menu}>
      {!limited && ITEMS.map(([section, href]) => <Link key={section} className="btn ghost" href={href} onClick={guard}
        aria-current={current === section ? "page" : undefined}>{t.nav[section]}</Link>)}
      <button className="btn ghost" onClick={() => void signOut()}>{t.nav.signOut}</button>
    </nav>
  </header>;
}
