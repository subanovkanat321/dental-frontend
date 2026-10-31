import { ApiError } from './api/client'
import { useMe } from './api/me'
import { Shell } from './layout/Shell'
import { SchedulePage } from './schedule/SchedulePage'

/**
 * CRM для компьютера (ADR 0001 бэкенда): тот же вход, что у сайта, — cookie-сессия после
 * «Войти через Telegram» на /login. Не вошли — ссылка на вход; пациент — сюда не пускаем.
 */
export function App() {
  const me = useMe()

  if (me.isPending) {
    return <div className="center hint">Загрузка…</div>
  }
  if (me.error) {
    if (me.error instanceof ApiError && me.error.status === 401) {
      return <Login />
    }
    return <div className="center error">Нет связи с сервером: {me.error.message}</div>
  }
  if (!me.data.doctor) {
    return (
      <div className="center">
        <h1>Tish CRM — для клиник</h1>
        <p className="hint">Сюда входят врачи, регистратура и администраторы клиники. Пациенты записываются через бота в Telegram.</p>
      </div>
    )
  }
  return (
    <Shell me={me.data}>
      <SchedulePage me={me.data} />
    </Shell>
  )
}

function Login() {
  return (
    <div className="center login">
      <img src={`${import.meta.env.BASE_URL}tooth.svg`} alt="" width={64} height={64} />
      <h1>Tish CRM</h1>
      <p className="hint">Расписание всех врачей, пациенты и касса — на большом экране.</p>
      <a className="btn primary" href="/login">Войти через Telegram</a>
      <p className="hint small">После входа откройте этот адрес снова.</p>
    </div>
  )
}
