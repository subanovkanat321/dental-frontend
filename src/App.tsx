import { ApiError } from './api/client'
import { useMe } from './api/me'
import { useState } from 'react'

import type { Schemas } from './api/client'
import { Shell } from './layout/Shell'
import { usePage } from './lib/route'
import { telegram } from './lib/telegram'
import { CashPage } from './cash/CashPage'
import { ClinicPage } from './clinic/ClinicPage'
import { PatientsPage } from './patients/PatientsPage'
import { SchedulePage } from './schedule/SchedulePage'
import { StockPage } from './stock/StockPage'
import { TeamPage } from './team/TeamPage'

/**
 * CRM для компьютера (ADR 0001 бэкенда): тот же вход, что у сайта, — cookie-сессия после
 * «Войти через Telegram» на /login. Не вошли — ссылка на вход; пациент — сюда не пускаем.
 */
export function App() {
  const me = useMe()
  const [page, go] = usePage()
  // «Записать» из карточки пациента: в «Расписание» с открытой «Новой записью» на него
  const [booking, setBooking] = useState<Schemas['PatientView'] | null>(null)

  if (me.isPending) {
    return <div className="center hint">Загрузка…</div>
  }
  if (me.error) {
    if (me.error instanceof ApiError && me.error.status === 401) {
      // В Telegram вход — подпись запуска; устарела — открыть заново из бота, а не «Войти через Telegram»
      return telegram()
        ? <div className="center"><h1>Tish CRM</h1><p className="hint">{me.error.message || 'Сессия устарела — закройте и откройте заново из бота.'}</p></div>
        : <Login />
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
    <Shell me={me.data} page={page} onNavigate={go}>
      {page === 'patients' && <PatientsPage me={me.data} onBook={(p) => { setBooking(p); go('schedule') }} />}
      {page === 'cash' && <CashPage me={me.data} />}
      {page === 'stock' && <StockPage me={me.data} />}
      {page === 'team' && <TeamPage me={me.data} />}
      {page === 'clinic' && <ClinicPage me={me.data} />}
      {page === 'schedule' && <SchedulePage me={me.data} bookPatient={booking} onBookingShown={() => setBooking(null)} onNavigate={go} />}
    </Shell>
  )
}

function Login() {
  return (
    <div className="center login">
      <img src={`${import.meta.env.BASE_URL}tooth.svg`} alt="" width={64} height={64} />
      <h1>Tish CRM</h1>
      <p className="hint">Расписание всех врачей, пациенты и касса — на большом экране.</p>
      <a className="btn primary" href="/login?next=/crm/">Войти через Telegram</a>
      <p className="hint small">После входа вернётесь сюда.</p>
    </div>
  )
}
