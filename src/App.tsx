import { api, ApiError, unwrap } from './api/client'
import { useMe } from './api/me'
import { useQuery } from '@tanstack/react-query'
import { lazy, Suspense, useState } from 'react'

import type { Schemas } from './api/client'
import { Login } from './layout/Login'
import { Shell } from './layout/Shell'
import { ErrorBoundary } from './layout/ErrorBoundary'
import { readDeepLink, rememberLaunch, type DeepLink } from './lib/deepLink'
import { isLoginPath, usePage, type Page } from './lib/route'
import { telegram } from './lib/telegram'

// Разделы — отдельными чанками: пациент не скачивает CRM, сотрудник — только открытый раздел
const CashPage = lazy(() => import('./cash/CashPage').then((m) => ({ default: m.CashPage })))
const PatientsPage = lazy(() => import('./patients/PatientsPage').then((m) => ({ default: m.PatientsPage })))
const PlatformPage = lazy(() => import('./platform/PlatformPage').then((m) => ({ default: m.PlatformPage })))
const SchedulePage = lazy(() => import('./schedule/SchedulePage').then((m) => ({ default: m.SchedulePage })))
const StockPage = lazy(() => import('./stock/StockPage').then((m) => ({ default: m.StockPage })))
const SettingsPage = lazy(() => import('./settings/SettingsPage').then((m) => ({ default: m.SettingsPage })))
// Самозапись пациента — тоже отдельный чанк: персонал его не скачивает
const PatientApp = lazy(() => import('./patient/PatientApp'))

/**
 * Одно приложение на всех (ADR 0001 и 0002 бэкенда): сотрудник видит CRM, команда платформы —
 * «Платформу», пациент в Telegram — самозапись. Вход: на сайте — cookie-сессия после «Войти через
 * Telegram» на /login, в Telegram — подпись запуска. Пациенту вне Telegram — подсказка про бота.
 */
export function App() {
  const me = useMe()
  // Кнопка бота (?appointment=…, ?screen=cash…): куда открыть — один раз; адрес чистим, чтобы
  // обновление страницы не открывало то же снова. Раздел — в #, как при обычном переходе
  const [link, setLink] = useState<DeepLink | null>(() => {
    rememberLaunch(window.location.search)
    const found = readDeepLink(window.location.search)
    if (found) {
      const hash = found.page === 'settings' && found.tab ? `settings/${found.tab}` : found.page
      window.history.replaceState(null, '', `${window.location.pathname}#/${hash}`)
    }
    return found
  })
  const [page, goPage] = usePage()
  const go = (next: Page) => {
    setLink(null)
    goPage(next)
  }
  // Имя пациента в карточке приёма → «Пациенты» с его карточкой
  const openPatient = (patientId: number) => {
    setLink({ page: 'patients', patientId })
    goPage('patients')
  }
  // Визит или долг в карточке пациента → «Расписание» с карточкой этого приёма
  const openAppointment = (appointmentId: number) => {
    setLink({ page: 'schedule', appointmentId })
    goPage('schedule')
  }
  // «Записать» из карточки пациента: в «Расписание» с открытой «Новой записью» на него
  const [booking, setBooking] = useState<Schemas['PatientView'] | null>(null)

  if (me.isPending) {
    return <div className="center hint">Загрузка…</div>
  }
  if (me.error) {
    if (me.error instanceof ApiError && me.error.status === 401) {
      // В Telegram вход — подпись запуска; устарела — открыть заново из бота, а не «Войти через Telegram»
      if (telegram()) {
        return <div className="center"><h1>Tish CRM</h1><p className="hint">{me.error.message || 'Сессия устарела — закройте и откройте заново из бота.'}</p></div>
      }
      // Браузер без входа на главной (пациент набрал адрес) — общий каталог клиник; вход — /login
      if (!isLoginPath()) {
        window.location.replace('/clinics')
        return <div className="center hint">Загрузка…</div>
      }
      return <Login />
    }
    return <div className="center error">Нет связи с сервером: {me.error.message}</div>
  }
  if (!me.data.doctor && !me.data.platform && telegram()) {
    return <ErrorBoundary><Suspense fallback={<div className="center hint">Загрузка…</div>}><PatientApp me={me.data} /></Suspense></ErrorBoundary>
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
      {/* Предохранитель на раздел: упал один экран — остальное работает; ключ — раздел, ушли и вернулись — заново */}
      <ErrorBoundary key={shown}>
      <Suspense fallback={<p className="hint">Загрузка…</p>}>
      {shown === 'patients' && <PatientsPage me={me.data} initialPatient={link?.patientId} onOpenAppointment={openAppointment} onBook={(p) => { setBooking(p); go('schedule') }} />}
      {shown === 'cash' && <CashPage me={me.data} initialTab={link?.tab} onOpenPatient={openPatient} />}
      {shown === 'stock' && <StockPage me={me.data} initialSupply={link?.supplyId} />}
      {shown === 'settings' && <SettingsPage me={me.data} initialTicket={link?.ticketId} />}
      {shown === 'platform' && me.data.platform && <PlatformPage me={me.data} initialTab={link?.page === 'platform' ? link.tab : undefined} />}
      {shown === 'schedule' && (link?.appointmentId || link?.bookPatientId
        ? <LinkedSchedule key={link.appointmentId ?? link.bookPatientId} link={link} me={me.data} onNavigate={go} onOpenPatient={openPatient} />
        : <SchedulePage me={me.data} initialDate={link?.date} initialDoctor={link?.doctorId} bookPatient={booking} onBookingShown={() => setBooking(null)} onNavigate={go} onOpenPatient={openPatient} />)}
      </Suspense>
      </ErrorBoundary>
    </Shell>
  )
}

/**
 * «Расписание» по кнопке бота: «Открыть приём» — день приёма с его карточкой; «Записать на приём»
 * из присланного боту контакта — «Новая запись» на этого пациента. Не нашёлся — просто сегодня.
 */
function LinkedSchedule({ link, me, onNavigate, onOpenPatient }: {
  link: DeepLink
  me: Schemas['BookingViewsMe']
  onNavigate: (page: Page) => void
  onOpenPatient: (patientId: number) => void
}) {
  const appointment = useQuery({
    queryKey: ['appointment', link.appointmentId],
    queryFn: () => unwrap(api.GET('/api/appointments/{id}', { params: { path: { id: link.appointmentId! } } })),
    enabled: link.appointmentId != null,
    retry: false,
  })
  const patient = useQuery({
    queryKey: ['patient-card', link.bookPatientId],
    queryFn: () => unwrap(api.GET('/api/appointments/by-patient/{patientId}', { params: { path: { patientId: link.bookPatientId! } } })),
    enabled: link.bookPatientId != null,
    retry: false,
  })
  if (appointment.isLoading || patient.isLoading) return <p className="hint">Загрузка…</p>
  return <SchedulePage me={me} openAppointment={appointment.data} bookPatient={patient.data?.patient ?? null} onNavigate={onNavigate} onOpenPatient={onOpenPatient} />
}
