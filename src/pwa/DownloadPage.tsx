import { InstallBody } from './InstallApp'
import { UpdateToast } from './UpdateToast'
import './pwa.css'

const POINTS: [string, string][] = [
  ['📅', 'Расписание всех врачей, запись и перенос в пару нажатий'],
  ['🔔', 'Заявки из бота и напоминания пациентам'],
  ['🦷', 'Карта зубов, план лечения, снимки'],
  ['💰', 'Касса, долги, зарплаты, склад'],
]

/**
 * «Скачать Tish» — tish.kg/app: CRM на экран телефона или компьютера (PWA). Страница без входа,
 * из CRM-сборки (index.html): только здесь браузер предлагает установку — у неё манифест и
 * service worker. С сайта и страницы входа на неё больше не ведём (владелец, 2026-11-02: «скачать как
 * приложение — не надо»): страница работает по прямой ссылке, установку предлагает и сама CRM (InstallHint).
 */
export function DownloadPage() {
  return (
    <main className="download">
      <header className="download-head">
        <img src={`${import.meta.env.BASE_URL}tishka-icon.svg`} alt="" width={48} height={72} />
        <div>
          <p className="hint">Для врачей, регистратуры и администраторов клиник</p>
          <h1>Tish на экране телефона</h1>
          <p>Значок на главном экране, своё окно без адресной строки — как обычное приложение. Без магазинов приложений и обновлений: новое появляется само.</p>
        </div>
      </header>
      <section className="card-block download-install" aria-label="Установить приложение">
        <h2>📲 Установить</h2>
        <InstallBody />
      </section>
      <ul className="download-points">
        {POINTS.map(([icon, text]) => <li key={text}><span aria-hidden="true">{icon}</span>{text}</li>)}
      </ul>
      <p className="hint download-foot">
        Уже установили? <a href="/login">Войти в Tish</a> · Пациенты записываются через бота в Telegram: <a href="/clinics">выбрать клинику</a>
      </p>
      <UpdateToast />
    </main>
  )
}
