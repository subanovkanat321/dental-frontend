import { api, ApiError, isUpdatingError, logout, unwrap } from './api/client'
import { ConfirmHost } from './layout/Confirm'
import { notify } from './lib/confirm'
import { useMe } from './api/me'
import { useQuery } from '@tanstack/react-query'
import { Activity, lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'

import type { Schemas } from './api/client'
import { DownloadPage } from './pwa/DownloadPage'
import { ErrorBoundary } from './layout/ErrorBoundary'
import { linkHash, readDeepLink, rememberLaunch, type DeepLink } from './lib/deepLink'
import { dateOf, minutesOf } from './lib/time'
import { isDemoPath, isDownloadPath, isInstagramPath, isInvitePath, isLoginPath, isSignupConfirmPath, isSignupPath, usePage, type Page } from './lib/route'
import { SectionActive } from './lib/section'
import { INSTAGRAM_SIGNUP } from './lib/brand'
import { telegram } from './lib/telegram'
import { launchedAsApp } from './pwa/pwa'
import { noteSectionLeft, updateAtSafeMoment } from './pwa/version'
import { hasUnsaved } from './lib/unsaved'
import { UpdateToast } from './pwa/UpdateToast'
import { closeAtlas, useAtlasRoute } from './atlas/route'
import { AtlasBoot, Loading } from './layout/Loading'
import { UpdatingScreen } from './layout/OfflineNotice'

// Оболочка CRM (меню, плашки) и вход — своими чанками: Mini App пациента их не скачивает
const Shell = lazy(() => import('./layout/Shell').then((m) => ({ default: m.Shell })))
const Login = lazy(() => import('./layout/Login').then((m) => ({ default: m.Login })))
// Разделы — отдельными чанками: пациент не скачивает CRM, сотрудник — только открытый раздел
const CashPage = lazy(() => import('./cash/CashPage').then((m) => ({ default: m.CashPage })))
const PatientsPage = lazy(() => import('./patients/PatientsPage').then((m) => ({ default: m.PatientsPage })))
const PlatformPage = lazy(() => import('./platform/PlatformPage').then((m) => ({ default: m.PlatformPage })))
const SchedulePage = lazy(() => import('./schedule/SchedulePage').then((m) => ({ default: m.SchedulePage })))
const StockPage = lazy(() => import('./stock/StockPage').then((m) => ({ default: m.StockPage })))
const SettingsPage = lazy(() => import('./settings/SettingsPage').then((m) => ({ default: m.SettingsPage })))
// «Клиника», «Я» и «Помощь» — экраны тех же пунктов, тот же кусочек кода, что у «Настроек»
const ClinicSection = lazy(() => import('./settings/SettingsPage').then((m) => ({ default: m.ClinicSection })))
const MineSection = lazy(() => import('./settings/SettingsPage').then((m) => ({ default: m.MineSection })))
const LearnPage = lazy(() => import('./learn/LearnPage').then((m) => ({ default: m.LearnPage })))
// Самозапись пациента — тоже отдельный чанк: персонал его не скачивает
const PatientApp = lazy(() => import('./patient/PatientApp'))
// 3D-атлас для показа пациенту — свой чанк с three.js (около 0,5 МБ): грузится, только когда его открыли
const AtlasPage = lazy(() => import('./atlas/AtlasPage'))
// Ссылка-приглашение (/invite#…) — маленький свой чанк: нужен один раз в жизни сотрудника
const InvitePage = lazy(() => import('./invite/InvitePage').then((m) => ({ default: m.InvitePage })))
// Регистрация клиники (/start) — тоже свой чанк: нужна один раз в жизни клиники
const SignupPage = lazy(() => import('./signup/SignupPage').then((m) => ({ default: m.SignupPage })))
// «Посмотреть демо» (/demo) — вход гостем в демо-клинику: маленький свой чанк
const DemoEnter = lazy(() => import('./demo/DemoEnter').then((m) => ({ default: m.DemoEnter })))
const SignupConfirmPage = lazy(() => import('./signup/ConfirmPage').then((m) => ({ default: m.ConfirmPage })))

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
      window.history.replaceState(null, '', `${window.location.pathname}#/${linkHash(found)}`)
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
    // С подразделом: «Мой заработок» из расписания — #/cash/earnings
    window.location.hash = `/${linkHash(next)}`
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
  // /invite#join_… — приглашение врача или сотрудника: без входа, до проверки сессии
  if (isInvitePath()) return <ErrorBoundary><Suspense fallback={<Loading className="screen" />}><InvitePage /></Suspense></ErrorBoundary>
  // tish.kg/ig (шапка Instagram) — сразу на регистрацию клиники с меткой канала; обычно это делает nginx
  if (isInstagramPath()) {
    window.location.replace(INSTAGRAM_SIGNUP)
    return <Loading className="screen" />
  }
  // /start — клиника регистрируется сама: без входа, до проверки сессии
  if (isSignupPath()) return <ErrorBoundary><Suspense fallback={<Loading className="screen" />}><SignupPage /></Suspense></ErrorBoundary>
  // /demo — «Посмотреть демо» на сайте: вход гостем в вымышленную клинику, до проверки сессии
  if (isDemoPath()) return <ErrorBoundary><Suspense fallback={<Loading className="screen" />}><DemoEnter /></Suspense></ErrorBoundary>
  // /start/confirm?t=… — ссылка из письма регистрации (открыли из почты, уже в настоящем браузере)
  if (isSignupConfirmPath()) return <ErrorBoundary><Suspense fallback={<Loading className="screen" />}><SignupConfirmPage /></Suspense></ErrorBoundary>
  // 3D-атлас (#/atlas, /atlas) — без входа: на экране нет данных пациентов, его можно открыть на ТВ
  if (atlas) return <ErrorBoundary><Suspense fallback={<AtlasBoot />}><AtlasPage route={atlas} onClose={closeAtlas} byUrl /></Suspense></ErrorBoundary>
  if (me.isPending) {
    // Tish обновляется — «кто вошёл» повторяется сам; вместо вечной «Загрузки…» — что происходит
    return isUpdatingError(me.failureReason) ? <UpdatingScreen /> : <Loading className="screen" />
  }
  // Перечитать «кто вошёл» не вышло, потому что Tish обновляется, а данные уже есть — работаем дальше с плашкой
  const failed = me.error && !(isUpdatingError(me.error) && me.data) ? me.error : null
  if (failed) {
    if (failed instanceof ApiError && failed.status === 401) {
      // В Telegram вход — подпись запуска; устарела — открыть заново из бота, а не «Войти через Telegram»
      if (telegram()) {
        return <div className="center"><h1>Tish CRM</h1><p className="hint">{failed.message || 'Сессия устарела — закройте и откройте заново из бота.'}</p></div>
      }
      // Браузер без входа на главной (пациент набрал адрес) — общий каталог клиник; вход — /login.
      // Запуск с иконки приложения (PWA) — это сотрудник: сразу вход, а не каталог для пациентов
      if (!isLoginPath() && !launchedAsApp()) {
        window.location.replace('/clinics')
        return <Loading className="screen" />
      }
      return <><Suspense fallback={<Loading className="screen" />}><Login /></Suspense><UpdateToast /></>
    }
    if (isUpdatingError(failed)) return <UpdatingScreen />
    return <div className="center error">Нет связи с сервером: {failed.message}</div>
  }
  if (!me.data) return <Loading className="screen" />
  if (!me.data.doctor && !me.data.platform && telegram()) {
    return <ErrorBoundary><Suspense fallback={<Loading className="screen" />}><PatientApp me={me.data} /></Suspense></ErrorBoundary>
  }
  if (!me.data.doctor && !me.data.platform) {
    return (
      <div className="center">
        <h1>Tish CRM — для клиник</h1>
        <p className="hint">Сюда входят врачи, регистратура и руководители клиники. Пациенты записываются через бота в Telegram.</p>
        {/* Вход есть, а клиники нет (клинику удалили, сотрудника убрали) — не тупик: выйти или создать свою */}
        <p className="hint">Этот вход не привязан ни к одной клинике.</p>
        <div className="actions">
          <a className="btn primary" href="/start">Создать клинику</a>
          <button type="button" className="btn" onClick={() => void logout()}>Выйти</button>
        </div>
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
      case 'patients': return <PatientsPage me={me.data} initialPatient={l?.patientId} initialQuestion={l?.questionId} initialTask={l?.taskId} initialTaskDraft={l?.taskDraft} initialBooked={l?.tab === 'booked' ? { date: l.date, unconfirmed: l.unconfirmed, unmarked: l.unmarked, doctorId: l.doctorId } : undefined} onOpenAppointment={openAppointment} onBookLead={(lead) => linkTo({ page: 'schedule', bookLeadId: lead.id })} onBook={(x, preset) => linkTo({ page: 'schedule', bookPatientId: x.id, ...(preset && { bookDoctorId: preset.doctorId, bookServiceId: preset.serviceId, bookDuration: preset.duration }) })} />
      case 'cash': return <CashPage me={me.data} onOpenPatient={openPatient} />
      case 'stock': return <StockPage me={me.data} initialSupply={l?.supplyId} initialLabOrder={l?.labOrderId} onOpenPatient={openPatient} />
      case 'learn': return <LearnPage />
      case 'settings': return <SettingsPage me={me.data} />
      case 'clinic': return <ClinicSection me={me.data} />
      case 'me': return <MineSection me={me.data} page="me" />
      case 'help': return <MineSection me={me.data} page="help" initialTicket={l?.ticketId} />
      case 'platform': return me.data.platform ? <PlatformPage me={me.data} /> : null
      case 'schedule': return l?.assistToken
        ? <LinkedAssist token={l.assistToken} me={me.data} onNavigate={go} onOpenPatient={openPatient}
          onTask={(draft) => linkTo({ page: 'patients', tab: 'tasks', taskDraft: draft })} />
        : l?.appointmentId || l?.bookPatientId || l?.contactToken || l?.bookLeadId
        ? <LinkedSchedule link={l} me={me.data} onNavigate={go} onOpenPatient={openPatient} />
        : <SchedulePage me={me.data} initialDate={l?.date} initialDoctor={l?.doctorId} bookPatient={booking} onBookingShown={() => setBooking(null)} onNavigate={go}
          onOpenEarnings={() => linkTo({ page: 'cash', tab: 'earnings' })} onOpenPatient={openPatient} />
      default: return null
    }
  }
  return (
    <Suspense fallback={<Loading className="screen" />}>
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
    </Suspense>
  )
}

/**
 * Открытые разделы: показан один, остальные скрыты, но живы — вернулись, и всё как было. У каждого
 * своя прокрутка страницы: ушли — запомнили, вернулись — на то же место; новый раздел — с начала.
 * Скрытый раздел не слушает «назад» Telegram и Esc (SectionActive) и не ходит на сервер (Activity).
 */
function Sections({ shown, sections, onVisit, children }: {
  shown: Page
  sections: Page[]
  onVisit: (pages: Page[]) => void
  children: (page: Page) => React.ReactNode
}) {
  const scroll = useRef<Partial<Record<Page, number>>>({})
  const current = useRef(shown)
  // Раздел уходит в фон: были несохранённые правки — помним (pwa/version.ts не перезагрузит поверх них).
  // В отрисовке, пока эффекты ушедшего раздела ещё не сняты и lib/unsaved видит его формы
  const [left, setLeft] = useState(shown)
  if (left !== shown) {
    noteSectionLeft(left, hasUnsaved())
    setLeft(shown)
  }
  // Сменили раздел — безопасный момент для тихого обновления на новую версию (если ничего не вводят)
  useEffect(() => { updateAtSafeMoment() }, [shown])
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
          {/* Activity: скрытый раздел сохраняет состояние, но его эффекты сняты — подписки React Query
              отключены, и он не опрашивает сервер (refetchInterval) и не перечитывает при фокусе окна.
              Вернулись — подписки снова, устаревшие данные (staleTime) перечитываются сами */}
          <Activity mode={p === shown ? 'visible' : 'hidden'}>
            <SectionActive.Provider value={p === shown}>{children(p)}</SectionActive.Provider>
          </Activity>
        </div>
      ))}
    </>
  )
}

/**
 * «✏️ Изменить» под карточкой помощника в боте (?assist=токен): черновик забираем один раз (токен одноразовый). Запись —
 * «Новая запись» с пациентом (или «Новый пациент» с именем), врачом, услугой, днём и временем; задача — «Пациенты →
 * Задачи» с окном задачи. Токен устарел — скажем и откроем расписание как обычно.
 */
function LinkedAssist({ token, me, onNavigate, onOpenPatient, onTask }: {
  token: string
  me: Schemas['BookingViewsMe']
  onNavigate: (page: Page) => void
  onOpenPatient: (patientId: number) => void
  onTask: (draft: Schemas['AssistDraft']) => void
}) {
  const draft = useQuery({
    queryKey: ['assist-draft', token],
    queryFn: () => unwrap(api.POST('/api/assist/draft', { body: { token } })),
    retry: false,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
  })
  const told = useRef(false)
  const task = draft.data?.kind === 'TASK' ? draft.data : null
  useEffect(() => {
    if (draft.error && !told.current) {
      told.current = true
      void notify(draft.error.message || 'Карточка устарела — напишите боту ещё раз')
    }
  }, [draft.error])
  const moved = useRef(false)
  useEffect(() => {
    if (task && !moved.current) {
      moved.current = true
      onTask(task)
    }
  }, [task, onTask])
  if (draft.isLoading || task) return <Loading />
  const d = draft.data
  if (!d) return <SchedulePage me={me} onNavigate={onNavigate} onOpenPatient={onOpenPatient} />
  const date = d.startAt ? dateOf(d.startAt) : undefined
  return <SchedulePage me={me} initialDate={date} bookPatient={d.patient ?? null}
    bookContact={!d.patient && d.newPatientName ? { fullName: d.newPatientName, phone: '' } : null}
    bookPreset={{ doctorId: d.doctorId ?? undefined, serviceId: d.serviceId ?? undefined, duration: d.durationMinutes ?? undefined, date,
      minutes: d.startAt ? minutesOf(d.startAt) : undefined, open: true }}
    onNavigate={onNavigate} onOpenPatient={onOpenPatient} />
}

/**
 * «Расписание» по кнопке бота: «Открыть приём» — день приёма с его карточкой; «📅 Записать» под
 * присланным боту контактом — «Новая запись» на этого пациента (?patient=ID) или с именем и номером
 * контакта (?contact=токен). Не нашёлся, токен устарел — просто сегодня.
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
  // «Записать» из «Обращений»: связано с карточкой — на неё, иначе — имя и номер, как контакт из бота
  const lead = useQuery({
    queryKey: ['leads', 'one', link.bookLeadId],
    queryFn: () => unwrap(api.GET('/api/leads/{id}', { params: { path: { id: link.bookLeadId! } } })),
    enabled: link.bookLeadId != null,
    retry: false,
  })
  const bookPatientId = link.bookPatientId ?? lead.data?.patientId ?? undefined
  const patient = useQuery({
    queryKey: ['patient-card', bookPatientId],
    queryFn: () => unwrap(api.GET('/api/appointments/by-patient/{patientId}', { params: { path: { patientId: bookPatientId! } } })),
    enabled: bookPatientId != null,
    retry: false,
  })
  // Контакт из бота: токен одноразовый — забираем один раз (staleTime: Infinity, без повторов); устарел — скажем
  const contact = useQuery({
    queryKey: ['shared-contact', link.contactToken],
    queryFn: () => unwrap(api.POST('/api/patients/shared-contact', { body: { token: link.contactToken! } })),
    enabled: link.contactToken != null,
    retry: false,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
  })
  const told = useRef(false)
  useEffect(() => {
    if (contact.error && !told.current) {
      told.current = true
      void notify(contact.error.message || 'Ссылка устарела — пришлите контакт боту ещё раз')
    }
  }, [contact.error])
  if (appointment.isLoading || patient.isLoading || contact.isLoading || lead.isLoading) return <Loading />
  const leadContact = lead.data && lead.data.patientId == null ? { fullName: lead.data.fullName ?? '', phone: lead.data.phone } : null
  return <SchedulePage me={me} openAppointment={appointment.data} bookPatient={patient.data?.patient ?? null} bookContact={contact.data ?? leadContact}
    bookLeadId={lead.data && lead.data.status !== 'BOOKED' ? lead.data.id : undefined}
    bookPreset={{ doctorId: link.bookDoctorId, serviceId: link.bookServiceId, duration: link.bookDuration }} onNavigate={onNavigate} onOpenPatient={onOpenPatient} />
}
