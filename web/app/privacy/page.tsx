import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "../brand";
import { LanguageSwitcher } from "../language-switcher";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t.meta.privacyTitle, description: t.meta.privacyDescription };
}

export default async function PrivacyPage() {
  const { t } = await getT();
  const p = t.privacy;
  return (
    <div className="wrap">
      <header className="topbar">
        <Brand />
        <LanguageSwitcher />
        <Link className="btn ghost" href="/login">{t.common.signIn}</Link>
      </header>
      <main className="panel stack" style={{ maxWidth: 880, margin: "5vh auto" }}>
        <div className="eyebrow">{p.eyebrow}</div>
        <h1>{p.title}</h1>
        <p className="muted">{p.updated}</p>

        <p>{p.intro}</p>

        <h2>{p.dataTitle}</h2>
        <ul>
          <li><strong>{p.googleDataTitle}</strong>{p.googleDataBefore}<code>openid</code>, <code>email</code> {p.and} <code>profile</code>{p.googleDataAfter}</li>
          <li><strong>{p.accountTitle}</strong>{p.accountText}</li>
          <li><strong>{p.learningTitle}</strong>{p.learningText}</li>
          <li><strong>{p.passkeysTitle}</strong>{p.passkeysText}</li>
          <li><strong>{p.technicalTitle}</strong>{p.technicalText}</li>
        </ul>

        <h2>{p.googleUseTitle}</h2>
        <p>{p.googleUseText}</p>

        <h2>{p.providersTitle}</h2>
        <p>{p.providersText}</p>
        <p className="small muted">{p.providersLinks} <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">Google</a>, <a href="https://supabase.com/privacy" target="_blank" rel="noreferrer">Supabase</a>, <a href="https://vercel.com/legal/privacy-notice" target="_blank" rel="noreferrer">Vercel</a>, <a href="https://groq.com/privacy-policy" target="_blank" rel="noreferrer">Groq</a>.</p>

        <h2>{p.storageTitle}</h2>
        <p>{p.storageText}</p>

        <h2>{p.securityTitle}</h2>
        <p>{p.securityText}</p>

        <h2>{p.contactTitle}</h2>
        <p>{p.contactBefore}<a href="mailto:mussayeva9794@gmail.com">mussayeva9794@gmail.com</a>{p.contactAfter}</p>

        <div className="divider" />
        <p className="small muted">{p.approval}</p>
      </main>
    </div>
  );
}
