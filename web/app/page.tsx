import Link from "next/link";

export default function Home() {
  return (
    <div className="wrap home-page">
      <header className="topbar">
        <Link className="brand" href="/">
          <span className="brand-mark">A</span> AI Teacher
        </Link>
        <nav className="navlinks" aria-label="Основная навигация">
          <Link className="btn ghost" href="/login">Войти</Link>
          <Link className="btn primary" href="/login?mode=signup">Начать</Link>
        </nav>
      </header>

      <main className="hero">
        <section className="hero-copy">
          <div className="eyebrow">Рабочее пространство для учителя</div>
          <h1>Ваше время — <em>для учеников.</em> Не для проверки тестов.</h1>
          <p>Создавайте четыре варианта, делитесь ссылкой с классом и смотрите результаты в одном месте. Без лишних вкладок и ручных таблиц.</p>
          <div className="hero-actions">
            <Link className="btn primary" href="/login?mode=signup">Начать работу <span aria-hidden="true">↗</span></Link>
            <Link className="btn" href="/login">У меня есть аккаунт</Link>
          </div>
          <div className="hero-footnote"><span className="hero-footnote-line" /> От идеи до готовой ссылки ученику</div>
        </section>

        <div className="hero-art" aria-hidden="true">
          <div className="hero-orb hero-orb-one" />
          <div className="hero-orb hero-orb-two" />
          <div className="hero-preview">
            <div className="hero-preview-top"><span className="hero-preview-brand"><span className="hero-preview-dot" /> AI Teacher</span><span>Рабочее пространство</span></div>
            <div className="hero-preview-body">
              <div className="hero-preview-overline">НОВЫЙ ТЕСТ / 11 КЛАСС</div>
              <div className="hero-preview-title">От темы к проверке знаний</div>
              <div className="hero-preview-description">Четыре варианта. Один понятный процесс.</div>
              <div className="hero-preview-options"><span>Вариант A</span><span>Вариант B</span><span>Вариант C</span><span>Вариант D</span></div>
              <div className="hero-preview-question"><span className="hero-preview-index">01 / 05</span><strong>Вопрос готов к проверке</strong><span className="hero-preview-line" /><span className="hero-preview-line short" /></div>
            </div>
          </div>
          <div className="hero-floating-card"><span>Результаты</span><strong>В одном месте</strong><span className="hero-floating-rule" /></div>
          <div className="hero-art-caption">ПРИМЕР ИНТЕРФЕЙСА</div>
        </div>
      </main>

      <section className="home-process" aria-label="Как это работает">
        <div className="home-process-head"><div className="eyebrow">Простой маршрут</div><h2>Меньше рутины.<br />Больше внимания классу.</h2></div>
        <div className="grid cols-3">
          <div className="panel process-card"><span className="process-number">01</span><h3>Подготовьте</h3><p className="muted">Задайте тему, класс и язык. Проверьте вопросы перед публикацией.</p></div>
          <div className="panel process-card"><span className="process-number">02</span><h3>Отправьте</h3><p className="muted">Поделитесь ссылкой, настройте время и список допущенных учеников.</p></div>
          <div className="panel process-card"><span className="process-number">03</span><h3>Увидьте результат</h3><p className="muted">Смотрите ответы и результаты в кабинете учителя.</p></div>
        </div>
      </section>
      <footer className="footer"><span>AI Teacher Test Generator</span><Link href="/account">Face ID / Touch ID</Link></footer>
    </div>
  );
}
