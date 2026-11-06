import { api, ApiError, unwrap } from './api/client'
import { ConfirmHost } from './layout/Confirm'
import { useMe } from './api/me'
import { useQuery } from '@tanstack/react-query'
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'

import type { Schemas } from './api/client'
import { DownloadPage } from './pwa/DownloadPage'
import { Login } from './layout/Login'
import { Shell } from './layout/Shell'
import { ErrorBoundary } from './layout/ErrorBoundary'
import { readDeepLink, rememberLaunch, type DeepLink } from './lib/deepLink'
import { isDownloadPath, isLoginPath, usePage, type Page } from './lib/route'
import { SectionActive } from './lib/section'
import { telegram } from './lib/telegram'
import { launchedAsApp } from './pwa/pwa'
import { UpdateToast } from './pwa/UpdateToast'
import { closeAtlas, useAtlasRoute } from './atlas/route'
import { AtlasBoot, Loading } from './layout/Loading'

// Разделы — отдельными чанками: пациент не скачивает CRM, сотрудник — только открытый раздел
const CashPage = lazy(() => import('./cash/CashPage').then((m) => ({ default: m.CashPage })))
const PatientsPage = lazy(() => import('./patients/PatientsPage').then((m) => ({ default: m.PatientsPage })))
const PlatformPage = lazy(() => import('./platform/PlatformPage').then((m) => ({ default: m.PlatformPage })))
const SchedulePage = lazy(() => import('./schedule/SchedulePage').then((m) => ({ default: m.SchedulePage })))
const StockPage = lazy(() => import('./stock/StockPage').then((m) => ({ default: m.StockPage })))
const SettingsPage = lazy(() => import('./settings/SettingsPage').then((m) => ({ default: m.SettingsPage })))
// Самозапись пациента — тоже отдельный чанк: персонал его не скачивает
const PatientApp = lazy(() => import('./patient/PatientApp'))
// 3D-атлас для показа пациенту — свой чанк с three.js (около 0,5 МБ): грузится, только когда его открыли
const AtlasPage = lazy(() => import('./atlas/AtlasPage'))

/**
 * Одно приложение на всех (ADR 0001 и 0002 бэкенда): сотрудник видит CRM, команда платформы —
 * «Платформу», пациент в Telegram — самозапись. Вход: на сайте — cookie-сессия после «Войти через
 * Telegram» на /login, в Telegram — подпись запуска. Пациенту вне Telegram — подсказка про бота.
 */
export function App() {
  // Подтверждения «Удалить …?» — своим окном, не системным (layout/Confirm)
  return <><Screens /><ConfirmHost /></>
}

function Screens() {
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
  const atlas = useAtlasRoute()
  // Разделы, где уже были, остаются открытыми (скрыты): вернулись — та же карточка, поиск, вкладка
  // и прокрутка. Ссылка на конкретное (пациент, приём, материал) открывает раздел заново — ключом.
  const [visited, setVisited] = useState<Page[]>([])
  const [keys, setKeys] = useState<Partial<Record<Page, number>>>(() => (link ? { [link.page]: 1 } : {}))
  const linkTo = (next: DeepLink) => {
    setLink(next)
    setKeys((k) => ({ ...k, [next.page]: (k[next.page] ?? 0) + 1 }))
    goPage(next.page)
  }
  const go = (next: Page) => goPage(next)
  // Имя пациента в карточке приёма → «Пациенты» с его карточкой
  const openPatient = (patientId: number) => linkTo({ page: 'patients', patientId })
  // Визит или долг в карточке пациента → «Расписание» с карточкой этого приёма
  const openAppointment = (appointmentId: number) => linkTo({ page: 'schedule', appointmentId })
  // «Записать» из карточки пациента: в «Расписание» с открытой «Новой записью» на него
  const [booking, setBooking] = useState<Schemas['PatientView'] | null>(null)

  // tish.kg/app — «Скачать Tish»: без входа, до проверки сессии
  if (isDownloadPath()) return <DownloadPage />
  // 3D-атлас (#/atlas, /atlas) — без входа: на экране нет данных пациентов, его можно открыть на ТВ
  if (atlas) return <ErrorBoundary><Suspense fallback={<AtlasBoot />}><AtlasPage route={atlas} onClose={closeAtlas} /></Suspense></ErrorBoundary>
  if (me.isPending) {
    return <Loading className="screen" />
  }
  if (me.error) {
    if (me.error instanceof ApiError && me.error.status === 401) {
      // В Telegram вход — подпись запуска; устарела — открыть заново из бота, а не «Войти через Telegram»
      if (telegram()) {
        return <div className="center"><h1>Tish CRM</h1><p className="hint">{me.error.message || 'Сессия устарела — закройте и откройте заново из бота.'}</p></div>
      }
      // Браузер без входа на главной (пациент набрал адрес) — общий каталог клиник; вход — /login.
      // Запуск с иконки приложения (PWA) — это сотрудник: сразу вход, а не каталог для пациентов
      if (!isLoginPath() && !launchedAsApp()) {
        window.location.replace('/clinics')
        return <Loading className="screen" />
      }
      return <><Login /><UpdateToast /></>
    }
    return <div className="center error">Нет связи с сервером: {me.error.message}</div>
  }
  if (!me.data.doctor && !me.data.platform && telegram()) {
    return <ErrorBoundary><Suspense fallback={<Loading className="screen" />}><PatientApp me={me.data} /></Suspense></ErrorBoundary>
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
  const sections = visited.includes(shown) ? visited : [...visited, shown]
  // Ссылка (кнопка бота, имя пациента) — только для своего раздела
  const linkOf = (p: Page) => (link?.page === p ? link : null)
  const section = (p: Page) => {
    const l = linkOf(p)
    switch (p) {
      case 'patients': return <PatientsPage me={me.data} initialPatient={l?.patientId} initialQuestion={l?.questionId} initialBooked={l?.tab === 'booked' ? { date: l.date, unconfirmed: l.unconfirmed, doctorId: l.doctorId } : undefined} onOpenAppointment={openAppointment} onBook={(x) => linkTo({ page: 'schedule', bookPatientId: x.id! })} />
      case 'cash': return <CashPage me={me.data} initialTab={l?.tab} onOpenPatient={openPatient} />
      case 'stock': return <StockPage me={me.data} initialSupply={l?.supplyId} />
      case 'settings': return <SettingsPage me={me.data} initialTicket={l?.ticketId} />
      case 'platform': return me.data.platform ? <PlatformPage me={me.data} initialTab={l?.tab} /> : null
      case 'schedule': return l?.appointmentId || l?.bookPatientId
        ? <LinkedSchedule link={l} me={me.data} onNavigate={go} onOpenPatient={openPatient} />
        : <SchedulePage me={me.data} initialDate={l?.date} initialDoctor={l?.doctorId} bookPatient={booking} onBookingShown={() => setBooking(null)} onNavigate={go}
          onOpenEarnings={() => linkTo({ page: 'cash', tab: 'earnings' })} onOpenPatient={openPatient} />
      default: return null
    }
  }
  return (
    <Shell me={me.data} page={shown} onNavigate={go}>
      <Sections shown={shown} sections={sections} onVisit={setVisited}>
        {(p) => (
          // Предохранитель на раздел: упал один экран — остальное работает
          <ErrorBoundary key={`${p}:${keys[p] ?? 0}`}>
            <Suspense fallback={<Loading />}>{section(p)}</Suspense>
          </ErrorBoundary>
        )}
      </Sections>
      <UpdateToast />
    </Shell>
  )
}

/**
 * Открытые разделы: показан один, остальные скрыты, но живы — вернулись, и всё как было. У каждого
 * своя прокрутка страницы: ушли — запомнили, вернулись — на то же место; новый раздел — с начала.
 * Скрытый раздел не слушает «назад» Telegram и Esc (SectionActive).
 */
function Sections({ shown, sections, onVisit, children }: {
  shown: Page
  sections: Page[]
  onVisit: (pages: Page[]) => void
  children: (page: Page) => React.ReactNode
}) {
  const scroll = useRef<Partial<Record<Page, number>>>({})
  const current = useRef(shown)
  useEffect(() => {
    if (sections.length) onVisit(sections)
  }, [sections, onVisit])
  useEffect(() => {
    const onScroll = () => { scroll.current[current.current] = window.scrollY }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  useLayoutEffect(() => {
    current.current = shown
    const y = scroll.current[shown] ?? 0
    window.scrollTo(0, y)
    // Раздел мог ещё догружаться (первый раз, данные) — повторим, когда он нарисуется
    const t = window.setTimeout(() => { if (current.current === shown && y) window.scrollTo(0, y) }, 120)
    return () => window.clearTimeout(t)
  }, [shown])
  return (
    <>
      {sections.map((p) => (
        <div key={p} className="section" hidden={p !== shown}>
          <SectionActive.Provider value={p === shown}>{children(p)}</SectionActive.Provider>
        </div>
      ))}
    </>
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
  if (appointment.isLoading || patient.isLoading) return <Loading />
  return <SchedulePage me={me} openAppointment={appointment.data} bookPatient={patient.data?.patient ?? null} onNavigate={onNavigate} onOpenPatient={onOpenPatient} />
}
