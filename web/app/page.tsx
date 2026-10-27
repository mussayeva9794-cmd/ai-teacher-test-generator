import Link from "next/link";
import type { CSSProperties } from "react";
import { PrepareIllustration, ResultsIllustration, ShareIllustration } from "./illustrations";
import { Brand, BRAND_NAME } from "./brand";
import { InstallHint } from "./install-hint";
import { LanguageSwitcher } from "./language-switcher";
import { getT } from "@/lib/i18n/server";

// Stagger index for the entrance animation in motion.css.
const order = (i: number) => ({ "--i": i }) as CSSProperties;
const ILLUSTRATIONS = [PrepareIllustration, ShareIllustration, ResultsIllustration];

export default async function Home() {
  const { t } = await getT();
  const h = t.home;
  return (
    <div className="wrap home-page">
      <header className="topbar">
        <Brand />
        <LanguageSwitcher />
        <nav className="navlinks" aria-label={t.nav.main}>
          <Link className="btn ghost" href="/login">{t.common.signIn}</Link>
          <Link className="btn primary" href="/login?mode=signup">{t.common.start}</Link>
        </nav>
      </header>
      <InstallHint />

      <main className="hero">
        <section className="hero-copy">
          <div className="eyebrow enter" style={order(0)}>{h.eyebrow}</div>
          <h1 className="enter" style={order(1)}>{h.titleBefore}<em>{h.titleEmphasis}</em>{h.titleAfter}</h1>
          <p className="enter" style={order(2)}>{h.lead}</p>
          <div className="hero-actions enter" style={order(3)}>
            <Link className="btn primary" href="/login?mode=signup">{h.startWork} <span aria-hidden="true">↗</span></Link>
            <Link className="btn" href="/login">{h.haveAccount}</Link>
          </div>
          <div className="hero-footnote enter" style={order(4)}><span className="hero-footnote-line" /> {h.footnote}</div>
        </section>

        <div className="hero-art enter" style={order(2)} aria-hidden="true">
          <div className="hero-orb hero-orb-one" />
          <div className="hero-orb hero-orb-two" />
          <div className="hero-preview">
            <div className="hero-preview-top"><span className="hero-preview-brand"><span className="hero-preview-dot" /> {BRAND_NAME}</span><span>{h.previewWorkspace}</span></div>
            <div className="hero-preview-body">
              <div className="hero-preview-overline">{h.previewOverline}</div>
              <div className="hero-preview-title">{h.previewTitle}</div>
              <div className="hero-preview-description">{h.previewDescription}</div>
              <div className="hero-preview-options">{["A", "B", "C", "D"].map(letter => <span key={letter}>{t.labels.variant(letter)}</span>)}</div>
              <div className="hero-preview-question"><span className="hero-preview-index">01 / 05</span><strong>{h.previewQuestion}</strong><span className="hero-preview-line" /><span className="hero-preview-line short" /></div>
            </div>
          </div>
          <div className="hero-floating-card"><span>{h.floatingLabel}</span><strong>{h.floatingValue}</strong><span className="hero-floating-rule" /></div>
          <div className="hero-art-caption">{h.artCaption}</div>
        </div>
      </main>

      <section className="home-process" aria-label={h.processLabel}>
        <div className="home-process-head"><div className="eyebrow">{h.processEyebrow}</div><h2>{h.processTitleLine1}<br />{h.processTitleLine2}</h2></div>
        <div className="grid cols-3">
          {h.steps.map((step, i) => {
            const Illustration = ILLUSTRATIONS[i];
            return <div className="panel process-card scroll-reveal" style={order(i)} key={step.title}><Illustration className="process-illustration" /><span className="process-number">{String(i + 1).padStart(2, "0")}</span><h3>{step.title}</h3><p className="muted">{step.text}</p></div>;
          })}
        </div>
      </section>
      <footer className="footer"><span>{BRAND_NAME}</span><div className="row"><Link href="/privacy">{t.common.privacy}</Link><Link href="/account">{t.common.passkeys}</Link></div></footer>
    </div>
  );
}
