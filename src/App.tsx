import { ApiError } from './api/client'
import { useMe } from './api/me'
import { lazy, Suspense, useState } from 'react'

import type { Schemas } from './api/client'
import { Shell } from './layout/Shell'
import { usePage } from './lib/route'
import { telegram } from './lib/telegram'

// Разделы — отдельными чанками: пациент не скачивает CRM, сотрудник — только открытый раздел
const AccountPage = lazy(() => import('./account/AccountPage').then((m) => ({ default: m.AccountPage })))
const CashPage = lazy(() => import('./cash/CashPage').then((m) => ({ default: m.CashPage })))
const ClinicPage = lazy(() => import('./clinic/ClinicPage').then((m) => ({ default: m.ClinicPage })))
const PatientsPage = lazy(() => import('./patients/PatientsPage').then((m) => ({ default: m.PatientsPage })))
const PlatformPage = lazy(() => import('./platform/PlatformPage').then((m) => ({ default: m.PlatformPage })))
const SchedulePage = lazy(() => import('./schedule/SchedulePage').then((m) => ({ default: m.SchedulePage })))
const StockPage = lazy(() => import('./stock/StockPage').then((m) => ({ default: m.StockPage })))
const TeamPage = lazy(() => import('./team/TeamPage').then((m) => ({ default: m.TeamPage })))
// Самозапись пациента — тоже отдельный чанк: персонал его не скачивает
const PatientApp = lazy(() => import('./patient/PatientApp'))

/**
 * Одно приложение на всех (ADR 0001 и 0002 бэкенда): сотрудник видит CRM, команда платформы —
 * «Платформу», пациент в Telegram — самозапись. Вход: на сайте — cookie-сессия после «Войти через
 * Telegram» на /login, в Telegram — подпись запуска. Пациенту вне Telegram — подсказка про бота.
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
  if (!me.data.doctor && !me.data.platform && telegram()) {
    return <Suspense fallback={<div className="center hint">Загрузка…</div>}><PatientApp me={me.data} /></Suspense>
  }
  if (!me.data.doctor && !me.data.platform) {
    return (
      <div className="center">
        <h1>Tish CRM — для клиник</h1>
        <p className="hint">Сюда входят врачи, регистратура и администраторы клиники. Пациенты записываются через бота в Telegram.</p>
      </div>
    )
  }
  // Команда платформы без своей клиники видит только «Платформу»
  const shown = me.data.doctor ? page : 'platform'
  return (
    <Shell me={me.data} page={shown} onNavigate={go}>
      <Suspense fallback={<p className="hint">Загрузка…</p>}>
      {shown === 'patients' && <PatientsPage me={me.data} onBook={(p) => { setBooking(p); go('schedule') }} />}
      {shown === 'cash' && <CashPage me={me.data} />}
      {shown === 'stock' && <StockPage me={me.data} />}
      {shown === 'team' && <TeamPage me={me.data} />}
      {shown === 'clinic' && <ClinicPage me={me.data} />}
      {shown === 'account' && <AccountPage me={me.data} />}
      {shown === 'platform' && me.data.platform && <PlatformPage me={me.data} />}
      {shown === 'schedule' && <SchedulePage me={me.data} bookPatient={booking} onBookingShown={() => setBooking(null)} onNavigate={go} />}
      </Suspense>
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
