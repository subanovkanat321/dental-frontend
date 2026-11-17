import { EmptyState } from '../layout/EmptyState'
import { RowMenu } from '../patients/CalmList'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { api, ApiError, unwrap, upload, type Schemas } from '../api/client'
import { PhoneInput } from '../clinic/PhoneInput'
import { phoneFromInput, phoneToInput } from '../clinic/phone'
import { ask as confirmAsk } from '../lib/confirm'
import { download } from '../lib/download'
import { Segments } from '../layout/Segments'
import { FilePicker } from '../layout/FilePicker'
import { Select } from '../layout/Select'
import { Loading } from '../layout/Loading'
import { CITIES } from '../lib/clinicSearch'
import { haptic, openLink } from '../lib/telegram'
import { whatsappUrl } from '../lib/texts'
import { formatPhone, shortDate, todayIn } from '../lib/time'
import { useClose } from '../lib/useClose'
import { useMedia } from '../lib/useMedia'
import { LeadStatus, OutreachTable } from './OutreachTable'
import { GROUPS, groupOf, instagramProfile, instagramUrl, messageFor, nextLead, PLACEHOLDER, prepareVideo, REACHES, reaches, remindDue, sendVideo, templateMessage, videoWay, type Channel, type Group, type OutreachLead, type Reach, type VideoResult } from './outreach'
import { SubHelp } from '../layout/PageHead'
import { rowOpen } from '../lib/rowClick'

type Template = Schemas['ClinicOutreachTemplate']
type Report = Schemas['ClinicOutreachImportReport']

const EMPTY_TEMPLATE: Template = { text: '', custom: false, remindAfterDays: 3 }

type View = 'list' | 'table'

/** Выбор «Список / Таблица» на этом устройстве — удобство, а не данные (клиник в ключе нет). */
const VIEW_KEY = 'tish.outreach.view'

/** С скольких клиник на компьютере по умолчанию таблица: десяток удобнее карточками, сотни — таблицей. */
const TABLE_FROM = 20

function savedView(): View | null {
  try {
    const v = localStorage.getItem(VIEW_KEY)
    return v === 'list' || v === 'table' ? v : null
  }
  catch {
    return null
  }
}

function saveView(view: View) {
  try {
    localStorage.setItem(VIEW_KEY, view)
  }
  catch {
    // приватное окно — не запомнили, не страшно
  }
}

/** Для поиска: строчные, «ё» как «е». */
const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/ё/g, 'е')

/**
 * Поиск по названию, адресу, телефону и Instagram (телефон — по цифрам: «555 000» найдёт «996555000401»; Instagram —
 * по логину, с «@» или без).
 */
function matches(l: OutreachLead, q: string, digits: string): boolean {
  const login = q.replace(/^@/, '')
  return norm(l.clinicName).includes(q) || norm(l.address).includes(q) || (digits.length >= 3 && (l.phone ?? '').includes(digits))
    || (login.length > 0 && (l.instagram ?? '').includes(login))
}

/**
 * «Написать клиникам» (владелец платформы): список стоматологий из 2ГИС и карт — загрузить, написать
 * каждой в WhatsApp своим нажатием (короткий текст с названием клиники, без ролика) и отметить «отправили»;
 * ответившим — текст №2 и ролик, молчащим 3+ дня — одно напоминание. Массовой отправки нет нарочно: WhatsApp блокирует номер за рассылки, а первое
 * сообщение должно быть личным. Клиники — те же лиды, что в «Воронке продаж» (Клиники).
 */
export function OutreachTab({ header, onPanel }: { header?: ReactNode; onPanel?: (open: boolean) => void }) {
  const outreach = useQuery({ queryKey: ['platform-outreach'], queryFn: () => unwrap(api.GET('/api/platform/outreach')) })
  const [group, setGroup] = useState<Group | null>(null)
  const [query, setQuery] = useState('')
  const [city, setCity] = useState('')
  const [reach, setReach] = useState<Reach | ''>('')
  const [selected, setSelected] = useState<number | null>(null)
  const phone = useMedia('(max-width: 760px)')
  const [chosenView, setChosenView] = useState<View | null>(savedView)
  const [exportError, setExportError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [adding, setAdding] = useState(false)
  const [allDone, setAllDone] = useState(false)
  const data = outreach.data
  const leads = useMemo(() => data?.leads ?? [], [data])
  const q = norm(query.trim())
  const digits = query.replace(/\D/g, '')
  // Город — фильтром, только когда городов в списке больше одного
  const cities = useMemo(() => [...new Set(leads.map((l) => l.city).filter((c): c is string => Boolean(c)))].sort((a, b) => a.localeCompare(b, 'ru')), [leads])
  const cityOn = cities.length > 1 && cities.includes(city) ? city : ''
  // «Канал» — фильтром, только когда у кого-то из клиник есть Instagram (иначе все — WhatsApp)
  const anyInstagram = useMemo(() => leads.some((l) => l.instagram), [leads])
  const reachOn = anyInstagram ? reach : ''
  // Открытая карточка остаётся на месте, даже когда после отметки ушла из фильтра «Не писали», — до «Следующей»
  const shown = useMemo(() => leads.filter((l) => l.id === selected || ((group == null || groupOf(l) === group)
    && (!cityOn || l.city === cityOn) && (!reachOn || reaches(l, reachOn)) && (!q || matches(l, q, digits)))), [leads, selected, group, cityOn, reachOn, q, digits])
  // № — место в полном списке (как загружали): от фильтра и сортировки не меняется
  const numbers = useMemo(() => new Map(leads.map((l, i) => [l.id, i + 1])), [leads])
  // На компьютере сотни клиник — таблицей, десяток — списком; на телефоне — списком; выбрали сами — как выбрали
  const view: View = chosenView ?? (!phone && leads.length > TABLE_FROM ? 'table' : 'list')
  const chooseView = (v: View) => {
    setChosenView(v)
    saveView(v)
  }
  const table = view === 'table' && leads.length > 0
  const panelLead = table && selected != null ? leads.find((l) => l.id === selected) ?? null : null
  // До отрисовки: отступ под карточку справа (.with-panel) — в том же кадре, что и сама карточка, иначе
  // layout/fitPanels.ts успел бы померить её внизу страницы и сжать до нуля
  const panelOpen = panelLead != null
  useLayoutEffect(() => {
    onPanel?.(panelOpen)
  }, [onPanel, panelOpen])
  const close = useCallback(() => setSelected(null), [])
  const exportFile = () => {
    setExportError(null)
    download('/api/platform/outreach/export?format=xlsx', `clinics-${todayIn()}.xlsx`)
      .catch((e: unknown) => setExportError(e instanceof Error ? e.message : String(e)))
  }
  const counts: Partial<NonNullable<NonNullable<typeof data>['counts']>> = data?.counts ?? {}
  const countOf: Record<Group, number> = { FRESH: counts.fresh ?? 0, SENT: counts.sent ?? 0, FURTHER: counts.further ?? 0, DECLINED: counts.declined ?? 0 }

  const next = () => {
    const lead = nextLead(leads, selected)
    setAllDone(lead == null)
    if (!lead) return
    // Следующая может быть не видна под фильтром или поиском — показываем всех неписаных
    if (!shown.some((l) => l.id === lead.id)) {
      setGroup('FRESH')
      setQuery('')
      setReach('')
    }
    setSelected(lead.id)
    setTimeout(() => document.getElementById(`outreach-${lead.id}`)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }), 0)
  }

  const body = (
    <>
      {/* Как писать — в «?» у заголовка: два абзаца над списком отодвигали его на полэкрана */}
      <SubHelp title="По одной (WhatsApp и Instagram)">Пишите по одной — своим нажатием: WhatsApp блокирует номер за массовые рассылки, а личное сообщение
          читают охотнее.<br /><br />
          <b>Не писали → «📨 Отправить сообщение»</b>: откроется WhatsApp с коротким текстом, без ролика и ссылок. Отправьте, вернитесь
          и отметьте «Да» — клиника перейдёт в «Написали».<br /><br />
          <b>Ответили → «🎬 Ответили — отправить ролик»</b>: ① текст со списком возможностей; ② вернитесь сюда — кнопка ролика:
          «Поделиться» → WhatsApp → этот чат (на компьютере ролик скачается — прикрепите в WhatsApp Web); ③ если нужно — шаблон Excel.
          «Да» — клиника в «Ответили/дальше».<br /><br />
          <b>Молчат 3 дня → «🔁 Напомнить»</b>: одно короткое напоминание. Больше не пишем — отказ отмечайте «Не беспокоить».<br /><br />
          <b>Instagram → «📸 Написать в Instagram»</b>: текст скопируется, откроется чат клиники в Instagram — вставьте текст
          (удерживайте поле → Вставить) и отправьте. Instagram — тоже по одной: 10–20 сообщений в день с нового аккаунта, иначе
          Instagram ограничит отправку. Пишите с аккаунта Tish (@tish.app.kg).</SubHelp>
      {outreach.error && <p className="error">{outreach.error.message}</p>}
      {outreach.isPending ? <Loading /> : data && (
        <>
          {/* Сначала — что пишем (свёрнуто: первая строка в заголовке), рядом — откуда клиники; ниже — сами клиники */}
          {data.template && <TemplateEditor template={data.template} />}
          <div className="actions outreach-tools">
            {!uploading && <button type="button" className="btn small" onClick={() => setUploading(true)}>Загрузить список клиник</button>}
            {leads.length > 0 && <button type="button" className="btn small" onClick={exportFile}>Скачать в Excel</button>}
            {!adding && <button type="button" className="btn small ghost" onClick={() => setAdding(true)}>＋ Добавить клинику</button>}
          </div>
          {exportError && <p className="error" role="alert">Файл не скачался: {exportError}</p>}
          {uploading && <ListUpload onClose={() => setUploading(false)} />}
          {adding && <OneClinic onClose={() => setAdding(false)} />}
          <section className="card-block" aria-label="Написать клиникам">
            {/* Фильтр и поиск — в шапке списка, рядом с тем, что фильтруют */}
            <div className="block-head">
              <h2>Клиники</h2>
              {leads.length > 0 && <button type="button" className="btn primary" onClick={next}>Следующая клиника →</button>}
            </div>
            {leads.length > 0 && <div className="outreach-filter">
              <Segments className="tabs" label="Кому писали" value={group ?? ''} onChange={(key) => setGroup(key === '' ? null : key)}
                options={[{ value: '' as Group | '', label: <>Все · <b className="num">{leads.length}</b></>, text: `Все · ${leads.length}` },
                  ...GROUPS.map(([key, title]) => ({ value: key, label: <>{title} · <b className="num">{countOf[key]}</b></>, text: `${title} · ${countOf[key]}` }))]} />
              {cities.length > 1 && (
                <Select className="outreach-city" aria-label="Город" value={cityOn} onChange={(e) => setCity(e.target.value)}>
                  <option value="">Все города</option>
                  {cities.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
              )}
              {anyInstagram && (
                <Select className="outreach-city" aria-label="Канал" value={reachOn} onChange={(e) => setReach(e.target.value as Reach | '')}>
                  <option value="">Все каналы</option>
                  {REACHES.map(([key, title]) => <option key={key} value={key}>{title}</option>)}
                </Select>
              )}
              <input type="search" className="outreach-search" aria-label="Поиск: название, адрес, телефон, Instagram" placeholder="Поиск: название, адрес, телефон, Instagram"
                value={query} onChange={(e) => setQuery(e.target.value)} />
              <div className="segments outreach-view" role="group" aria-label="Вид">
                {(['list', 'table'] as const).map((v) => (
                  <button key={v} type="button" aria-pressed={view === v} onClick={() => chooseView(v)}>{v === 'list' ? 'Список' : 'Таблица'}</button>
                ))}
              </div>
            </div>}
            {allDone && <p className="tone-ok" role="status">Неписаных клиник нет — всем из списка уже написали.</p>}
            {leads.length === 0 ? <EmptyState compact title="Список клиник пуст">«Загрузить список клиник» — вставьте клиники из 2ГИС или таблицы.</EmptyState>
              : shown.length === 0 ? <p className="hint">Здесь никого.</p>
                : table ? (
                  <OutreachTable rows={shown} numbers={numbers} selected={selected} onOpen={setSelected}
                    resetKey={`${group ?? ''}|${q}|${cityOn}|${reachOn}`} />
                ) : (
                  <div role="list" className="funnel-list" aria-label="Клиники">
                    {shown.map((l) => (
                      <LeadRow key={l.id} lead={l} template={data.template ?? EMPTY_TEMPLATE} selected={l.id === selected}
                        onSelect={() => setSelected(l.id === selected ? null : l.id)} onActive={() => setSelected(l.id)} onNext={next} />
                    ))}
                  </div>
                )}
          </section>
        </>
      )}
    </>
  )
  return (
    <>
      <section className="schedule-main">
        {header}
        {body}
      </section>
      {/* Таблица: клиника — карточкой справа (те же шаги и действия, что в строке списка) */}
      {panelLead && data && (
        <LeadPanel key={panelLead.id} lead={panelLead} template={data.template ?? EMPTY_TEMPLATE} onClose={close}
          onActive={() => setSelected(panelLead.id)} onNext={next} />
      )}
    </>
  )
}

/** Карточка клиники справа (вид «Таблица»): Esc и «назад» закрывают, внутри — та же {@link LeadRow}. */
function LeadPanel({ lead, template, onClose, onActive, onNext }: {
  lead: OutreachLead; template: Template; onClose: () => void; onActive: () => void; onNext: () => void
}) {
  const close = useClose(onClose)
  return (
    <aside className="panel" aria-label={`Клиника: ${lead.clinicName}`}>
      <LeadRow lead={lead} template={template} selected onSelect={close} onActive={onActive} onNext={onNext} onClose={close} />
    </aside>
  )
}

/**
 * Где клиника в отправке: message — открыли WhatsApp с текстом №2 и ждём возврата в приложение; video —
 * вернулись, крупно шаг ② (ролик); ask — «Отправили?»; done — отметили, «Следующая».
 */
type Step = 'message' | 'video' | 'ask' | 'done' | null

/**
 * Что отправляем: first — первое сообщение (без ролика), video — ответившим: текст №2, ролик и шаблон Excel,
 * remind — одно напоминание молчащим.
 */
type Mode = 'first' | 'video' | 'remind'

const FURTHER_STAGES = ['DEMO', 'TRIAL', 'PAYING']

function LeadRow({ lead: l, template, selected, onSelect, onActive, onNext, onClose }: {
  lead: OutreachLead; template: Template; selected: boolean; onSelect: () => void; onActive: () => void; onNext: () => void
  /** Есть — строка открыта карточкой справа (вид «Таблица»): заголовок карточки с ✕ вместо строки списка */
  onClose?: () => void
}) {
  const client = useQueryClient()
  const [step, setStep] = useState<Step>(null)
  const [mode, setMode] = useState<Mode>('first')
  // Куда отправляем сейчас: WhatsApp (текст — в ссылке) или Instagram (текст — из буфера)
  const [channel, setChannel] = useState<Channel>('WHATSAPP')
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const [declining, setDeclining] = useState(false)
  const [editing, setEditing] = useState(false)
  const [reason, setReason] = useState('')
  const [video, setVideo] = useState<VideoResult | 'pending' | null>(null)
  const [videoError, setVideoError] = useState<string | null>(null)
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['platform-outreach'] })
    void client.invalidateQueries({ queryKey: ['platform-funnel'] })
  }
  const marked = {
    onSuccess: () => {
      setStep('done')
      haptic('success')
      refresh()
    },
  }
  const sent = useMutation<OutreachLead, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/platform/outreach/{id}/sent', { params: { path: { id: l.id } }, body: { channel } })),
    ...marked,
  })
  // Ответили — этап «Демо» тем же запросом, что в «Воронке продаж»: заметку и следующий шаг передаём как были
  const replied = useMutation<OutreachLead, ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/platform/funnel/{id}', {
      params: { path: { id: l.id } },
      body: { stage: 'DEMO', note: l.note || undefined, nextStep: l.nextStep || undefined, nextStepOn: l.nextStepOn || undefined },
    })),
    ...marked,
  })
  const reminded = useMutation<OutreachLead, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/platform/outreach/{id}/reminded', { params: { path: { id: l.id } } })),
    ...marked,
  })
  const decline = useMutation<OutreachLead, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/platform/outreach/{id}/decline', { params: { path: { id: l.id } }, body: { reason: reason || undefined } })),
    onSuccess: () => {
      setDeclining(false)
      refresh()
    },
  })
  // «Удалить из списка» — клиника исчезает из рассылки и воронки совсем (подключённую — нельзя, 409 с текстом)
  const remove = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.DELETE('/api/platform/outreach/{id}', { params: { path: { id: l.id } } })),
    onSuccess: refresh,
  })
  const g = groupOf(l)
  const fresh = g === 'FRESH'
  const lost = l.stage === 'LOST'
  const first = messageFor(template.text ?? '', l.clinicName ?? '')
  const videoText = template.videoText ?? ''
  // В Instagram ролик ссылкой не прикрепить — в тексте №2 вместо «👇» ссылка на страницу с роликом
  const igVideoText = messageFor(template.instagramVideoText ?? videoText, l.clinicName ?? '')
  const reminderText = template.reminderText ?? ''
  // В карточке — то, что сейчас уйдёт: неписаным — первое сообщение, остальным — текст к ролику
  const text = fresh ? first : videoText
  const remind = remindDue(l, template.remindAfterDays ?? 3)
  const way = videoWay()

  // Карточка написавшей клиники открыта — ролик заранее в память (один раз на вкладку): «Поделиться» потом сразу
  const reachable = Boolean(l.phone || l.instagram)
  useEffect(() => {
    if (selected && !lost && !fresh && reachable && way !== 'telegram') prepareVideo().catch(() => {})
  }, [selected, lost, fresh, reachable, way])

  // Шаг 1 → 2: WhatsApp открыли — ждём, когда владелец вернётся в приложение (вкладка снова видна или окно
  // в фокусе), и только после того, как ушёл (иначе шаг 2 выскочил бы сразу)
  useEffect(() => {
    if (step !== 'message') return
    let left = document.visibilityState === 'hidden'
    const away = () => { left = true }
    const back = () => {
      if (left && document.visibilityState !== 'hidden') setStep('video')
    }
    const visibility = () => (document.visibilityState === 'hidden' ? away() : back())
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('blur', away)
    window.addEventListener('focus', back)
    return () => {
      document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('blur', away)
      window.removeEventListener('focus', back)
    }
  }, [step])

  // Вернулись из WhatsApp — шаг 2 сразу на виду (на телефоне карточка длинная)
  const stepTwo = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (step === 'video') stepTwo.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
  }, [step])

  const ask = (m: Mode, via: Channel = 'WHATSAPP') => {
    onActive()
    setMode(m)
    setChannel(via)
    setStep('ask')
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      setCopied(false)
    }
    ask(fresh ? 'first' : 'video')
  }
  /**
   * Instagram: текст по ссылке не подставить — копируем его в буфер и открываем Direct клиники (ig.me/m/логин).
   * Буфер — в том же нажатии и до перехода: иначе iPhone запретит запись (нет жеста) или вкладка уже скрыта.
   * Ссылку открываем сразу, не дожидаясь буфера: долгий await «протух» бы жест и окно не открылось бы.
   */
  const toInstagram = (message: string, m: Mode) => {
    onActive()
    setCopyFailed(false)
    setCopied(true)
    const failed = () => {
      setCopied(false)
      setCopyFailed(true)
    }
    try {
      navigator.clipboard.writeText(message).catch(failed)
    } catch {
      failed()
    }
    openLink(instagramUrl(l.instagram!))
    setMode(m)
    setChannel('INSTAGRAM')
    if (m === 'video') {
      setVideo(null)
      setStep('message')
      if (way !== 'telegram') prepareVideo().catch(() => {})
    }
    else setStep('ask')
  }
  // Текст — сразу в поле чата и на телефоне, и на компьютере (whatsappUrl на Windows сам убирает эмодзи: из ссылки
  // они приходят «�»). Копировать-вставлять не нужно
  const open = (message: string) => openLink(whatsappUrl(l.phone!, message))
  // Первое сообщение — холодное, только текст: ролик и ссылки незнакомому номеру похожи на рассылку
  const sendFirst = () => {
    open(first)
    ask('first')
  }
  // Ответили — текст №2, потом ролик файлом; ролик тем временем качается в память
  const sendVideoText = () => {
    onActive()
    open(videoText)
    setMode('video')
    setChannel('WHATSAPP')
    setVideo(null)
    setStep('message')
    if (way !== 'telegram') prepareVideo().catch(() => {})
  }
  const sendReminder = () => {
    open(reminderText)
    ask('remind')
  }
  // Напоминание и ролик — сначала тем каналом, которым написали (Instagram — и когда телефона нет)
  const igFirst = l.contactedVia === 'INSTAGRAM' || !l.phone
  // Третьим (после текста №2 и ролика) — шаблон переезда: «заполните, и мы всё перенесём»
  const openTemplate = () => open(templateMessage())
  // Ролик: sendVideo зовёт «Поделиться» синхронно, в этом же нажатии (iPhone иначе откажет)
  const shareVideo = (afterMessage: boolean) => {
    onActive()
    setMode('video')
    setVideoError(null)
    setVideo('pending')
    sendVideo().then((r) => {
      setVideo(r)
      if (r !== 'cancelled' && r !== 'retry') setStep('ask')
      else if (afterMessage) setStep('video')
    }, (e: unknown) => {
      setVideo(null)
      setVideoError(e instanceof Error ? e.message : String(e))
    })
  }
  const yes = () => {
    if (mode === 'first') sent.mutate()
    else if (mode === 'remind') reminded.mutate()
    // Уже дальше по воронке (демо, пробный, платит) — назад на «Демо» не двигаем
    else if (FURTHER_STAGES.includes(l.stage ?? '')) setStep('done')
    else replied.mutate()
  }
  const busy = sent.isPending || replied.isPending || reminded.isPending
  const status = <LeadStatus lead={l} />
  const instagram = channel === 'INSTAGRAM'
  const igButton = (label: string, m: Mode, message: string, primary: boolean) => (
    <button type="button" className={primary ? 'btn primary' : 'btn'} onClick={() => toInstagram(message, m)}>{label}</button>
  )
  const source = <>{l.source === 'SITE' && <span className="hint small"> · заявка с сайта</span>}{l.source === 'SELF' && <span className="hint small"> · сама зарегистрировалась</span>}</>
  const error = sent.error ?? replied.error ?? reminded.error ?? decline.error
  return (
    <div {...(onClose ? { className: 'form outreach-lead in-panel' } : {
      role: 'listitem', id: `outreach-${l.id}`, 'aria-label': `Клиника: ${l.clinicName}`, 'aria-current': selected || undefined,
      ...rowOpen(!selected && onSelect, 'sub-form form outreach-lead', selected && 'active'),
    })}>
      {onClose ? (
        <header className="panel-head">
          <div>
            <h2>{l.clinicName}</h2>
            <span>{status}{source}</span>
          </div>
          <button type="button" className="btn ghost" aria-label="Закрыть" onClick={onClose}>✕</button>
        </header>
      ) : (
        <strong><button type="button" className="row-link" aria-expanded={selected} onClick={onSelect}>{l.clinicName}</button> {status}{source}</strong>
      )}
      <span className="hint">{[l.city, l.address].filter(Boolean).join(' · ')}
        {l.phone && <>{l.city || l.address ? ' · ' : ''}{formatPhone(l.phone)}</>}
        {l.instagram && <>{l.city || l.address || l.phone ? ' · ' : ''}<a href={instagramProfile(l.instagram)} target="_blank" rel="noopener noreferrer">@{l.instagram}</a></>}
        {l.link && <> · <a href={l.link} target="_blank" rel="noopener noreferrer">ссылка</a></>}
        {g !== 'SENT' && l.contactedAt && <> · написали {shortDate(l.contactedAt)}</>}
        {l.remindedAt && <> · напомнили {shortDate(l.remindedAt)}</>}</span>
      {lost && <span className="tone-bad">Просили не беспокоить{l.lostReason ? `: ${l.lostReason}` : ''} — не пишем.</span>}
      {selected && !lost && <p className="outreach-text" aria-label="Текст сообщения">{text}</p>}
      {!lost && step == null && (
        <div className="actions">
          {l.phone && fresh && <button type="button" className="btn primary" onClick={sendFirst}>📨 Отправить сообщение</button>}
          {l.instagram && fresh && igButton('📸 Написать в Instagram', 'first', first, !l.phone)}
          {!fresh && (l.phone && !igFirst
            ? <>
                <button type="button" className={g === 'SENT' ? 'btn primary' : 'btn'} onClick={sendVideoText}>🎬 Ответили — отправить ролик</button>
                {l.instagram && igButton('📸 Ролик в Instagram', 'video', igVideoText, false)}
              </>
            : <>
                {l.instagram && igButton('🎬 Ответили — ролик в Instagram', 'video', igVideoText, g === 'SENT')}
                {l.phone && <button type="button" className="btn" onClick={sendVideoText}>🎬 Ролик в WhatsApp</button>}
              </>)}
          {remind && (l.instagram && igFirst
            ? igButton('🔁 Напомнить в Instagram', 'remind', reminderText, false)
            : l.phone && <button type="button" className="btn" onClick={sendReminder}>🔁 Напомнить</button>)}
          {!l.phone && !l.instagram && l.link && <button type="button" className="btn" onClick={() => { openLink(l.link!); ask(fresh ? 'first' : 'video') }}>Открыть ссылку</button>}
          {/* Остальное — в «⋯» (как в списках «Пациентов»): четыре тихие кнопки под главной шли столбиком по одной */}
          <RowMenu label={`Ещё: ${l.clinicName}`} items={[
            ...(!fresh ? [{ label: video === 'pending' ? 'Готовлю ролик…' : 'Только ролик', disabled: video === 'pending', onSelect: () => shareVideo(false) }] : []),
            { label: 'Скопировать текст', onSelect: () => void copy() },
            ...(l.phone && !fresh ? [{ label: 'Шаблон Excel', onSelect: () => { openTemplate(); ask('video') } }] : []),
            ...(!declining ? [{ label: 'Не беспокоить', tone: 'bad' as const, onSelect: () => setDeclining(true) }] : []),
          ]} />
        </div>
      )}
      {step === 'message' && (
        <div className="outreach-step" role="status">
          <span>{instagram
            ? '① Текст скопирован — вставьте его в чат Instagram (удерживайте поле → Вставить), отправьте и вернитесь сюда: будет шаг ② — ролик.'
            : '① Текст открыт в WhatsApp — отправьте его и вернитесь сюда: будет шаг ② — ролик.'}</span>
          <span className="actions">
            <button type="button" className="btn small" onClick={() => setStep('video')}>Текст отправлен → к ролику</button>
            <button type="button" className="btn small ghost" onClick={() => setStep(null)}>Отмена</button>
          </span>
        </div>
      )}
      {step === 'video' && (
        <div ref={stepTwo} className="outreach-step big" role="group" aria-label="Шаг 2: ролик">
          <strong>🎬 Теперь ролик</strong>
          <span>{instagram
            ? <>Ролик: скачайте и отправьте в чат из галереи{way === 'share' ? ' (кнопка → «Сохранить видео»)' : ''}. Ссылка tish.kg/about уже в тексте —
              можно и без файла.</>
            : way === 'share' ? 'Нажмите кнопку → WhatsApp → выберите этот чат (он первый в списке).'
              : way === 'telegram' ? 'Ролик откроется в браузере → «Поделиться» → WhatsApp → этот чат (он первый в списке).'
                : 'Файл скачается — прикрепите его в этот чат WhatsApp Web (📎 → «Фото и видео»).'}</span>
          {video === 'retry' && <span className="tone-wait">Ролик загрузился — нажмите ещё раз.</span>}
          <span className="actions">
            <button type="button" className="btn primary" disabled={video === 'pending'} onClick={() => shareVideo(true)}>
              {video === 'pending' ? 'Готовлю ролик…' : way === 'download' || instagram ? '🎬 Скачать ролик' : '🎬 Отправить ролик'}</button>
            <button type="button" className="btn ghost" onClick={() => setStep('ask')}>Без ролика</button>
          </span>
        </div>
      )}
      {copied && step !== 'ask' && step !== 'message' && <span className="tone-ok" role="status">Текст скопирован</span>}
      {copyFailed && <p className="tone-wait" role="alert">Текст не скопировался — скопируйте его из карточки выше и вставьте в чат.</p>}
      {video && video !== 'pending' && video !== 'cancelled' && video !== 'retry' && step !== 'done' && (
        <span className="tone-ok" role="status">{VIDEO_DONE[video]}</span>
      )}
      {videoError && <p className="error" role="alert">Ролик не открылся: {videoError}</p>}
      {step === 'ask' && (
        <div className="outreach-ask" role="group" aria-label="Отправили?">
          <span>{instagram && copied ? 'Текст скопирован — вставьте его в чат (удерживайте поле → Вставить) и отправьте. Instagram не умеет подставлять текст по ссылке. '
            : copied ? 'Текст скопирован. ' : ''}{ASK[mode](l.clinicName ?? '')}</span>
          <span className="actions">
            <button type="button" className="btn primary small" disabled={busy} onClick={yes}>Да</button>
            <button type="button" className="btn small" onClick={() => setStep(null)}>Нет</button>
            {l.phone && mode === 'video' && !instagram && (
              <button type="button" className="btn small ghost" onClick={openTemplate}
                title="Третьим сообщением: «Вот шаблон — заполните, и мы всё перенесём»">📥 Ещё и шаблон Excel</button>
            )}
          </span>
        </div>
      )}
      {step === 'done' && (
        <div className="outreach-ask" role="group" aria-label="Отмечено">
          <span className="tone-ok">{DONE[mode](l.clinicName ?? '')}{instagram && mode === 'first' ? ' Написали в Instagram.' : ''}</span>
          <span className="actions">
            <button type="button" className="btn primary" onClick={() => { setStep(null); onNext() }}>Следующая клиника →</button>
          </span>
        </div>
      )}
      {selected && !editing && (
        <div className="actions">
          {l.clinicId == null
            ? <button type="button" className="btn small" onClick={() => setEditing(true)}>Изменить</button>
            : <span className="hint small">Клиника подключена — её данные правят в «Клиниках».</span>}
          <button type="button" className="btn small danger" disabled={remove.isPending}
            onClick={() => void confirmAsk(`Удалить «${l.clinicName}» из списка? Клиника исчезнет из рассылки и воронки.`).then((ok) => ok && remove.mutate())}>
            Удалить из списка</button>
        </div>
      )}
      {editing && <EditClinic lead={l} onClose={() => setEditing(false)} />}
      {remove.error && <p className="error" role="alert">{remove.error.message}</p>}
      {declining && (
        <form className="form" aria-label={`Не беспокоить: ${l.clinicName}`} onSubmit={(e) => { e.preventDefault(); decline.mutate() }}>
          <label className="field"><span>Почему — для себя</span>
            <input value={reason} maxLength={200} placeholder="Не интересно / уже есть программа" onChange={(e) => setReason(e.target.value)} /></label>
          <div className="actions">
            <button type="submit" className="btn" disabled={decline.isPending}>Больше не писать</button>
            <button type="button" className="btn ghost" onClick={() => setDeclining(false)}>Отмена</button>
          </div>
        </form>
      )}
      {error && <p className="error" role="alert">{error.message}</p>}
    </div>
  )
}

const ASK: Record<Mode, (name: string) => string> = {
  first: (name) => `Отправили «${name}»?`,
  video: (name) => `Отправили «${name}» ролик? Клиника перейдёт в «Ответили».`,
  remind: (name) => `Напомнили «${name}»?`,
}

const DONE: Record<Mode, (name: string) => string> = {
  first: (name) => `✓ «${name}» — в «Написали».`,
  video: (name) => `✓ «${name}» — в «Ответили/дальше».`,
  remind: (name) => `✓ «${name}» — напомнили. Больше не напоминаем.`,
}

const VIDEO_DONE: Record<'shared' | 'downloaded' | 'opened', string> = {
  shared: 'Ролик отправлен через «Поделиться».',
  downloaded: 'Ролик скачан — прикрепите его в чат клиники в WhatsApp.',
  opened: 'Ролик открыт в браузере — нажмите «Поделиться» → WhatsApp → чат клиники.',
}

/** Город клиники: из списка городов, а свой (из загруженного файла) — тоже вариантом. */
function cityOptions(current: string): string[] {
  const cities: readonly string[] = CITIES
  return current && !cities.includes(current) ? [current, ...cities] : [...cities]
}

/**
 * «Изменить» клинику — вдруг номер написали неправильно: название, телефон (страна + номер), адрес,
 * ссылка, город. Проверяет сервер: телефон нормализует, номер другой клиники — 409 с её названием.
 */
function EditClinic({ lead: l, onClose }: { lead: OutreachLead; onClose: () => void }) {
  const client = useQueryClient()
  const [f, setF] = useState({ name: l.clinicName ?? '', phone: phoneToInput(l.phone), instagram: l.instagram ? `@${l.instagram}` : '', address: l.address ?? '', link: l.link ?? '', city: l.city || 'Бишкек' })
  const save = useMutation<OutreachLead, ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/platform/outreach/{id}', {
      params: { path: { id: l.id } },
      body: { clinicName: f.name, phone: phoneFromInput(f.phone), instagram: f.instagram, address: f.address, link: f.link, city: f.city },
    })),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['platform-outreach'] })
      void client.invalidateQueries({ queryKey: ['platform-funnel'] })
      onClose()
    },
  })
  const set = (k: keyof typeof f) => (v: string) => { setF({ ...f, [k]: v }); save.reset() }
  const err = (field: string) => save.error?.fieldErrors[field]
  const conflict = save.error && !Object.keys(save.error.fieldErrors).length ? save.error.message : null
  return (
    <form className="form" aria-label={`Изменить: ${l.clinicName}`} onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
      <div className="row">
        <label className="field"><span>Название *</span><input required value={f.name} maxLength={100} onChange={(e) => set('name')(e.target.value)} /></label>
        <label className="field"><span>Телефон (WhatsApp)</span><PhoneInput label="Телефон (WhatsApp)" value={f.phone} onChange={set('phone')} /></label>
        <label className="field"><span>Instagram</span>
          <input value={f.instagram} maxLength={300} placeholder="@логин или ссылка" autoCapitalize="none" autoCorrect="off" spellCheck={false}
            onChange={(e) => set('instagram')(e.target.value)} /></label>
      </div>
      {(err('clinicName') || err('phone') || err('instagram')) && <p className="error">{err('clinicName') ?? err('phone') ?? err('instagram')}</p>}
      <div className="row">
        <label className="field"><span>Адрес</span><input value={f.address} maxLength={200} onChange={(e) => set('address')(e.target.value)} /></label>
        <label className="field"><span>Ссылка (2ГИС, карты, Instagram)</span>
          <input value={f.link} placeholder="https://…" onChange={(e) => set('link')(e.target.value)} /></label>
        <label className="field"><span>Город</span>
          <Select value={f.city} onChange={(e) => set('city')(e.target.value)}>{cityOptions(f.city).map((c) => <option key={c} value={c}>{c}</option>)}</Select>
        </label>
      </div>
      {(err('link') || err('address') || err('city')) && <p className="error">{err('link') ?? err('address') ?? err('city')}</p>}
      {conflict && <p className="error" role="alert">{conflict}</p>}
      <div className="actions">
        <button type="submit" className="btn primary" disabled={save.isPending || !f.name.trim() || (!f.phone.trim() && !f.instagram.trim() && !f.link.trim())}>Сохранить</button>
        <button type="button" className="btn ghost" onClick={onClose}>Отмена</button>
      </div>
    </form>
  )
}

/**
 * «＋ Добавить клинику» — по одной, если в списке пропустили. Тот же серверный разбор, что у загрузки
 * списка (одна строка с заголовками): нормализация телефона, дубль — тот же номер, ошибки. Телефон — страна + номер.
 */
function OneClinic({ onClose }: { onClose: () => void }) {
  const client = useQueryClient()
  const empty = { name: '', phone: '', instagram: '', address: '', link: '' }
  const [f, setF] = useState(empty)
  const [city, setCity] = useState('Бишкек')
  const set = (k: keyof typeof empty) => (v: string) => { setF({ ...f, [k]: v }); add.reset() }
  const cell = (v: string) => v.replace(/[\t\r\n]+/g, ' ').trim()
  const add = useMutation<Report, ApiError>({
    mutationFn: () => {
      const body = new FormData()
      body.append('text', `Название\tТелефон\tInstagram\tАдрес\tСсылка\n${[f.name, phoneFromInput(f.phone), f.instagram, f.address, f.link].map(cell).join('\t')}`)
      body.append('city', city)
      return upload<Report>('/api/platform/outreach/import', body)
    },
    onSuccess: (r) => {
      if (r.added) {
        setF(empty)
        void client.invalidateQueries({ queryKey: ['platform-outreach'] })
        void client.invalidateQueries({ queryKey: ['platform-funnel'] })
      }
    },
  })
  const r = add.data
  const row = r?.rows?.[0]
  return (
    <form className="sub-form form" aria-label="Добавить клинику" onSubmit={(e) => { e.preventDefault(); add.mutate() }}>
      <div className="row">
        <label className="field"><span>Название *</span><input required value={f.name} maxLength={200} onChange={(e) => set('name')(e.target.value)} /></label>
        <label className="field"><span>Телефон (WhatsApp)</span><PhoneInput label="Телефон (WhatsApp)" value={f.phone} onChange={set('phone')} /></label>
        <label className="field"><span>Instagram</span>
          <input value={f.instagram} maxLength={300} placeholder="@логин или ссылка" autoCapitalize="none" autoCorrect="off" spellCheck={false}
            onChange={(e) => set('instagram')(e.target.value)} /></label>
        <label className="field"><span>Адрес</span><input value={f.address} maxLength={300} onChange={(e) => set('address')(e.target.value)} /></label>
        <label className="field"><span>Ссылка (2ГИС, карты, Instagram)</span>
          <input value={f.link} placeholder="https://…" onChange={(e) => set('link')(e.target.value)} /></label>
        <label className="field"><span>Город</span>
          <Select value={city} onChange={(e) => setCity(e.target.value)}>{CITIES.map((c) => <option key={c} value={c}>{c}</option>)}</Select>
        </label>
      </div>
      <p className="hint">Нужно название и телефон или Instagram.</p>
      <div className="actions">
        <button type="submit" className="btn primary" disabled={add.isPending || !f.name.trim() || (!f.phone.trim() && !f.instagram.trim() && !f.link.trim())}>Добавить</button>
        <button type="button" className="btn ghost" onClick={onClose}>Закрыть</button>
      </div>
      {r && (r.added ? <p className="tone-ok" role="status">Добавлена «{row?.clinicName}» — она в списке «Не писали».</p>
        : row?.status === 'DUPLICATE' ? <p className="tone-wait" role="status">Эта клиника уже в списке{row.message ? ` — ${row.message}` : ''}. Не добавляли.</p>
          : <p className="error" role="alert">{row?.message ?? 'Не добавилось — проверьте поля'}</p>)}
      {add.error && <p className="error" role="alert">{add.error.message}</p>}
    </form>
  )
}

/** «Загрузить список клиник»: вставить текст или выбрать файл → предпросмотр → добавить новые. */
function ListUpload({ onClose }: { onClose: () => void }) {
  const client = useQueryClient()
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [city, setCity] = useState('Бишкек')
  const form = () => {
    const body = new FormData()
    if (file) body.append('file', file)
    else body.append('text', text)
    body.append('city', city)
    return body
  }
  const preview = useMutation<Report, ApiError>({ mutationFn: () => upload<Report>('/api/platform/outreach/import/preview', form()) })
  const apply = useMutation<Report, ApiError>({
    mutationFn: () => upload<Report>('/api/platform/outreach/import', form()),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['platform-outreach'] })
      void client.invalidateQueries({ queryKey: ['platform-funnel'] })
    },
  })
  const changed = () => {
    preview.reset()
    apply.reset()
  }
  const r = preview.data
  const done = apply.data
  const error = preview.error ?? apply.error
  return (
    <div className="sub-form form" role="group" aria-label="Загрузить список клиник">
      <strong>Загрузить список клиник</strong>
      <p className="hint">Строка — одна клиника: <b>Название; телефон; адрес; ссылка</b> (2ГИС, карты или Instagram), Instagram — ещё
        и «@логин» или колонкой «Instagram». Можно скопировать колонки из Excel или Google-таблицы — разделитель «;» или табуляция.
        Обязательно название и телефон или Instagram. Номер можно с кодом страны: +7 701 123 45 67. Клиника — это её номер или
        Instagram: кто уже в списке (тот же номер или логин, в том числе заявки с сайта), просто пропустим; две клиники с одним
        названием и разными номерами — разные.</p>
      <p className="hint">Скачать шаблон:{' '}
        <button type="button" className="link" onClick={() => void download('/api/platform/outreach/import/template?format=xlsx', 'клиники-шаблон.xlsx')}>Excel (.xlsx)</button>
        {' · '}
        <button type="button" className="link" onClick={() => void download('/api/platform/outreach/import/template?format=csv', 'клиники-шаблон.csv')}>CSV</button>
        {' '}— колонки «Название, Телефон, Instagram, Адрес, Ссылка, Город» и строки-примеры.</p>
      <label className="field"><span>Список</span>
        <textarea value={text} rows={6} disabled={Boolean(file)} placeholder={'Стоматология «Пример»; 0555 000 000; ул. Примерная, 1; https://2gis.kg/…'}
          onChange={(e) => { setText(e.target.value); changed() }} /></label>
      <FilePicker label="Или файл .xlsx / .csv" button="Выбрать файл (.xlsx, .csv)" accept=".xlsx,.csv,.txt" file={file}
        onChange={(f) => { setFile(f ?? null); changed() }} onClear={() => { setFile(null); changed() }} />
      <label className="field"><span>Город, если не указан в строке</span>
        <Select value={city} onChange={(e) => { setCity(e.target.value); changed() }}>
          {CITIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select></label>
      {error && <p className="error" role="alert">{Object.values(error.fieldErrors)[0] ?? error.message}</p>}
      {done ? (
        <p className="tone-ok" role="status">Добавлено клиник: {done.added}. Они — в «Не писали», по порядку списка.
          {done.duplicates ? ` Уже были в списке — пропустили: ${done.duplicates}.` : ''}{done.errors ? ` С ошибками — не добавили: ${done.errors}.` : ''}</p>
      ) : r ? (
        <>
          <p className="stats" aria-label="Итог проверки">
            <span className="chip small s-ok">Новых: <b className="num">{r.fresh}</b></span>
            {r.duplicates > 0 && <span className="chip small s-quiet">уже в списке — пропустим: <b className="num">{r.duplicates}</b></span>}
            {r.errors > 0 && <span className="chip small s-bad">С ошибкой — не добавим: <b className="num">{r.errors}</b></span>}
          </p>
          {r.errors > 0 && r.fresh > 0 && <p className="hint">Строки с ошибкой загрузке не мешают: добавим остальные, а эти можно поправить и загрузить потом.</p>}
          {r.fresh === 0 && <p className="hint">Новых клиник нет — добавлять нечего.</p>}
          <table className="table" aria-label="Проверка списка">
            <thead><tr><th className="r">Строка</th><th>Клиника</th><th>Телефон / Instagram</th><th>Итог</th></tr></thead>
            <tbody>
              {(r.rows ?? []).map((row) => (
                <tr key={row.line}>
                  <td className="r num">{row.line}</td>
                  <td>{row.clinicName || '—'}{row.address && <span className="hint"> · {row.address}</span>}</td>
                  <td className="nowrap">{[row.phone && formatPhone(row.phone), row.instagram && `@${row.instagram}`].filter(Boolean).join(' · ')
                    || (row.link ? 'ссылка' : '—')}</td>
                  <td className={row.status === 'NEW' ? 'tone-ok' : row.status === 'ERROR' ? 'tone-bad' : 'hint'}>
                    {row.status === 'NEW' ? 'Добавим' : row.status === 'DUPLICATE' ? `пропустим · ${row.message ?? 'уже в списке'}` : row.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
      <div className="actions">
        {!done && (r && r.fresh > 0
          ? <button type="button" className="btn primary" disabled={apply.isPending} onClick={() => apply.mutate()}>Добавить клиник: {r.fresh}</button>
          : <button type="button" className="btn primary" disabled={preview.isPending || (!file && !text.trim())} onClick={() => preview.mutate()}>Проверить</button>)}
        <button type="button" className="btn ghost" onClick={onClose}>{done ? 'Закрыть' : 'Отмена'}</button>
      </div>
    </div>
  )
}

/**
 * Текст первого сообщения: {клиника} подставится названием; пусто или «Вернуть» — текст по умолчанию. Текст к ролику
 * и напоминание — только посмотреть: они приходят с сервера и обновляются вместе с приложением.
 */
function TemplateEditor({ template }: { template: Template }) {
  const client = useQueryClient()
  const [text, setText] = useState(template.text ?? '')
  const firstLine = (template.text ?? '').split('\n').map((x) => x.trim()).find(Boolean) ?? ''
  const save = useMutation<Template, ApiError, string>({
    mutationFn: (value) => unwrap(api.PUT('/api/platform/outreach/template', { body: { text: value } })),
    onSuccess: (t) => {
      setText(t.text ?? '')
      void client.invalidateQueries({ queryKey: ['platform-outreach'] })
    },
  })
  return (
    <section className="card-block outreach-template" aria-label="Текст сообщения">
      {/* Свёрнут по умолчанию: в заголовке — первая строка, чтобы видеть, что уходит, не занимая экран */}
      <details>
        <summary><b>Текст сообщения{template.custom ? ' (свой)' : ''}</b>
          {firstLine && <span className="outreach-template-line">{firstLine}</span>}</summary>
        <form className="form" onSubmit={(e) => { e.preventDefault(); save.mutate(text) }}>
          <p className="hint">Первое сообщение клинике. {PLACEHOLDER} — подставится название. Ролик и ссылки сюда не ставьте:
            незнакомому номеру они похожи на рассылку — ролик уходит ответившим.</p>
          <label className="field"><span>Текст</span>
            <textarea value={text} rows={8} maxLength={1500} onChange={(e) => setText(e.target.value)} /></label>
          {!text.includes(PLACEHOLDER) && <p className="tone-wait">В тексте нет {PLACEHOLDER} — название клиники не подставится.</p>}
          {save.error && <p className="error" role="alert">{save.error.fieldErrors.text ?? save.error.message}</p>}
          {save.isSuccess && <p className="tone-ok" role="status">Сохранено</p>}
          <div className="actions">
            <button type="submit" className="btn primary" disabled={save.isPending}>Сохранить текст</button>
            {template.custom && <button type="button" className="btn ghost" disabled={save.isPending} onClick={() => save.mutate('')}>Вернуть текст по умолчанию</button>}
          </div>
        </form>
        <p className="hint">Ответившим — с роликом:</p>
        <p className="outreach-text" aria-label="Текст к ролику">{template.videoText}</p>
        <p className="hint">Напоминание молчащим (через {template.remindAfterDays} дня, один раз):</p>
        <p className="outreach-text" aria-label="Текст напоминания">{template.reminderText}</p>
      </details>
    </section>
  )
}
