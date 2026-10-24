"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { browserClient } from "@/lib/supabase";

type Section = "tests" | "classes" | "create" | "account";

const ITEMS: [Section, string, string][] = [
  ["tests", "Тесты", "/dashboard"],
  ["classes", "Классы", "/classes"],
  ["create", "Создать", "/create"],
  ["account", "Аккаунт", "/account"],
];

/**
 * One teacher menu for every teacher page. `canLeave` lets a page with
 * unsaved edits ask before navigating away.
 */
export function TeacherHeader({ current, canLeave, limited = false }: {
  current?: Section;
  canLeave?: () => boolean;
  /** Signed-in non-teachers see only "Выйти". */
  limited?: boolean;
}) {
  const router = useRouter();
  const guard = (event: React.MouseEvent) => { if (canLeave && !canLeave()) event.preventDefault(); };
  async function signOut() {
    if (canLeave && !canLeave()) return;
    await browserClient().auth.signOut();
    router.replace("/");
  }
  return <header className="topbar teacher-topbar">
    <Link className="brand" href="/" onClick={guard}><span className="brand-mark">A</span><span className="brand-text"> AI Teacher</span></Link>
    <nav className="navlinks" aria-label="Меню учителя">
      {!limited && ITEMS.map(([section, label, href]) => <Link key={section} className="btn ghost" href={href} onClick={guard}
        aria-current={current === section ? "page" : undefined}>{label}</Link>)}
      <button className="btn ghost" onClick={() => void signOut()}>Выйти</button>
    </nav>
  </header>;
}
