import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import { api, ApiError, unwrap, upload, type Schemas } from '../api/client'
import { PhoneInput } from '../clinic/PhoneInput'
import { phoneFromInput, phoneToInput } from '../clinic/phone'
import { ask as confirmAsk } from '../lib/confirm'
import { download } from '../lib/download'
import { FilePicker } from '../layout/FilePicker'
import { Select } from '../layout/Select'
import { Loading } from '../layout/Loading'
import { CITIES } from '../lib/clinicSearch'
import { haptic, openLink } from '../lib/telegram'
import { whatsappUrl } from '../lib/texts'
import { formatPhone, shortDate } from '../lib/time'
import { GROUPS, groupOf, messageFor, nextLead, PLACEHOLDER, prepareVideo, remindDue, sendVideo, templateMessage, videoWay, type Group, type OutreachLead, type VideoResult } from './outreach'
import { SubHelp } from '../layout/PageHead'
import { rowOpen } from '../lib/rowClick'

type Template = Schemas['ClinicOutreachTemplate']
type Report = Schemas['ClinicOutreachImportReport']

const EMPTY_TEMPLATE: Template = { text: '', custom: false, remindAfterDays: 3 }

const STAGE_TEXT: Record<string, string> = { DEMO: 'Ответили', TRIAL: 'Пробный период', PAYING: 'Платит' }

/**
 * «Написать клиникам» (владелец платформы): список стоматологий из 2ГИС и карт — загрузить, написать
 * каждой в WhatsApp своим нажатием (короткий текст с названием клиники, без ролика) и отметить «отправили»;
 * ответившим — текст №2 и ролик, молчащим 3+ дня — одно напоминание. Массовой отправки нет нарочно: WhatsApp блокирует номер за рассылки, а первое
 * сообщение должно быть личным. Клиники — те же лиды, что в «Воронке продаж» (Клиники).
 */
export function OutreachTab() {
  const outreach = useQuery({ queryKey: ['platform-outreach'], queryFn: () => unwrap(api.GET('/api/platform/outreach')) })
  const [group, setGroup] = useState<Group | null>(null)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<number | null>(null)
  const [uploading, setUploading] = useState(false)
  const [adding, setAdding] = useState(false)
  const [allDone, setAllDone] = useState(false)
  const data = outreach.data
  const leads = data?.leads ?? []
  const q = query.trim().toLowerCase().replace(/ё/g, 'е')
  // Открытая карточка остаётся на месте, даже когда после отметки ушла из фильтра «Не писали», — до «Следующей»
  const shown = leads.filter((l) => l.id === selected || ((group == null || groupOf(l) === group)
    && (!q || (l.clinicName ?? '').toLowerCase().replace(/ё/g, 'е').includes(q))))
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
    }
    setSelected(lead.id)
    setTimeout(() => document.getElementById(`outreach-${lead.id}`)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }), 0)
  }

  return (
    <>
      {/* Как писать — в «?» у заголовка: два абзаца над списком отодвигали его на полэкрана */}
      <SubHelp title="Написать клиникам">Пишите по одной — своим нажатием: WhatsApp блокирует номер за массовые рассылки, а личное сообщение
          читают охотнее.<br /><br />
          <b>Не писали → «📨 Отправить сообщение»</b>: откроется WhatsApp с коротким текстом, без ролика и ссылок. Отправьте, вернитесь
          и отметьте «Да» — клиника перейдёт в «Написали».<br /><br />
          <b>Ответили → «🎬 Ответили — отправить ролик»</b>: ① текст со списком возможностей; ② вернитесь сюда — кнопка ролика:
          «Поделиться» → WhatsApp → этот чат (на компьютере ролик скачается — прикрепите в WhatsApp Web); ③ если нужно — шаблон Excel.
          «Да» — клиника в «Ответили/дальше».<br /><br />
          <b>Молчат 3 дня → «🔁 Напомнить»</b>: одно короткое напоминание. Больше не пишем — отказ отмечайте «Не беспокоить».</SubHelp>
      <section className="card-block" aria-label="Написать клиникам">
        {outreach.error && <p className="error">{outreach.error.message}</p>}
        {outreach.isPending ? <Loading /> : data && (
          <>
            <div className="segments tabs" role="group" aria-label="Кому писали">
              <button type="button" aria-pressed={group == null} onClick={() => setGroup(null)}>Все · <b className="num">{leads.length}</b></button>
              {GROUPS.map(([key, title]) => (
                <button key={key} type="button" aria-pressed={group === key} onClick={() => setGroup(key)}>
                  {title} · <b className="num">{countOf[key]}</b></button>
              ))}
            </div>
            <div className="actions">
              <input type="search" className="outreach-search" aria-label="Поиск по названию" placeholder="Поиск по названию" value={query}
                onChange={(e) => setQuery(e.target.value)} />
              <button type="button" className="btn primary" onClick={next}>Следующая клиника →</button>
              {!adding && <button type="button" className="btn" onClick={() => setAdding(true)}>＋ Добавить клинику</button>}
              {!uploading && <button type="button" className="btn" onClick={() => setUploading(true)}>Загрузить список клиник</button>}
            </div>
            {allDone && <p className="tone-ok" role="status">Неписаных клиник нет — всем из списка уже написали.</p>}
            {adding && <OneClinic onClose={() => setAdding(false)} />}
            {uploading && <ListUpload onClose={() => setUploading(false)} />}
            {leads.length === 0 ? <p className="hint">Список пуст. Нажмите «Загрузить список клиник» и вставьте клиники из 2ГИС или таблицы.</p>
              : shown.length === 0 ? <p className="hint">Здесь никого.</p>
                : (
                  <div role="list" className="funnel-list" aria-label="Клиники">
                    {shown.map((l) => (
                      <LeadRow key={l.id} lead={l} template={data.template ?? EMPTY_TEMPLATE} selected={l.id === selected}
                        onSelect={() => setSelected(l.id === selected ? null : l.id)} onActive={() => setSelected(l.id)} onNext={next} />
                    ))}
                  </div>
                )}
          </>
        )}
      </section>
      {data?.template && <TemplateEditor template={data.template} />}
    </>
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

function LeadRow({ lead: l, template, selected, onSelect, onActive, onNext }: {
  lead: OutreachLead; template: Template; selected: boolean; onSelect: () => void; onActive: () => void; onNext: () => void
}) {
  const client = useQueryClient()
  const [step, setStep] = useState<Step>(null)
  const [mode, setMode] = useState<Mode>('first')
  const [copied, setCopied] = useState(false)
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
    mutationFn: () => unwrap(api.POST('/api/platform/outreach/{id}/sent', { params: { path: { id: l.id } } })),
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
  const reminderText = template.reminderText ?? ''
  // В карточке — то, что сейчас уйдёт: неписаным — первое сообщение, остальным — текст к ролику
  const text = fresh ? first : videoText
  const remind = remindDue(l, template.remindAfterDays ?? 3)
  const way = videoWay()

  // Карточка написавшей клиники открыта — ролик заранее в память (один раз на вкладку): «Поделиться» потом сразу
  useEffect(() => {
    if (selected && !lost && !fresh && l.phone && way !== 'telegram') prepareVideo().catch(() => {})
  }, [selected, lost, fresh, l.phone, way])

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

  const ask = (m: Mode) => {
    onActive()
    setMode(m)
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
    setVideo(null)
    setStep('message')
    if (way !== 'telegram') prepareVideo().catch(() => {})
  }
  const sendReminder = () => {
    open(reminderText)
    ask('remind')
  }
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
  const status = fresh ? <span className="chip small s-quiet">Не писали</span>
    : g === 'SENT' ? <span className="chip small s-ok">Написали{l.contactedAt ? ` ${shortDate(l.contactedAt)}` : ''}</span>
      : g === 'DECLINED' ? <span className="chip small s-bad">Отказ</span>
        : <span className="chip small s-request">{STAGE_TEXT[l.stage ?? ''] ?? 'Дальше'}</span>
  const error = sent.error ?? replied.error ?? reminded.error ?? decline.error
  return (
    <div role="listitem" id={`outreach-${l.id}`} {...rowOpen(!selected && onSelect, 'sub-form form outreach-lead', selected && 'active')} aria-label={`Клиника: ${l.clinicName}`}
      aria-current={selected || undefined}>
      <strong><button type="button" className="row-link" aria-expanded={selected} onClick={onSelect}>{l.clinicName}</button> {status}
        {l.source === 'SITE' && <span className="hint small"> · заявка с сайта</span>}</strong>
      <span className="hint">{[l.city, l.address].filter(Boolean).join(' · ')}
        {l.phone && <>{l.city || l.address ? ' · ' : ''}{formatPhone(l.phone)}</>}
        {l.link && <> · <a href={l.link} target="_blank" rel="noopener noreferrer">ссылка</a></>}
        {g !== 'SENT' && l.contactedAt && <> · написали {shortDate(l.contactedAt)}</>}
        {l.remindedAt && <> · напомнили {shortDate(l.remindedAt)}</>}</span>
      {lost && <span className="tone-bad">Просили не беспокоить{l.lostReason ? `: ${l.lostReason}` : ''} — не пишем.</span>}
      {selected && !lost && <p className="outreach-text" aria-label="Текст сообщения">{text}</p>}
      {!lost && step == null && (
        <div className="actions">
          {l.phone && fresh && <button type="button" className="btn primary" onClick={sendFirst}>📨 Отправить сообщение</button>}
          {l.phone && !fresh && (
            <button type="button" className={g === 'SENT' ? 'btn primary' : 'btn'} onClick={sendVideoText}>🎬 Ответили — отправить ролик</button>
          )}
          {l.phone && remind && <button type="button" className="btn" onClick={sendReminder}>🔁 Напомнить</button>}
          {!l.phone && l.link && <button type="button" className="btn" onClick={() => { openLink(l.link!); ask(fresh ? 'first' : 'video') }}>Открыть ссылку</button>}
          {!declining && <button type="button" className="btn ghost" onClick={() => setDeclining(true)}>Не беспокоить</button>}
        </div>
      )}
      {!lost && step == null && (
        <div className="actions outreach-more" role="group" aria-label="По отдельности">
          {!fresh && (
            <button type="button" className="btn small ghost" disabled={video === 'pending'} onClick={() => shareVideo(false)}>
              {video === 'pending' ? 'Готовлю ролик…' : 'Только ролик'}</button>
          )}
          <button type="button" className="btn small ghost" onClick={() => void copy()}>Скопировать текст</button>
          {l.phone && !fresh && (
            <button type="button" className="btn small ghost" onClick={() => { openTemplate(); ask('video') }}>Шаблон Excel</button>
          )}
        </div>
      )}
      {step === 'message' && (
        <div className="outreach-step" role="status">
          <span>① Текст открыт в WhatsApp — отправьте его и вернитесь сюда: будет шаг ② — ролик.</span>
          <span className="actions">
            <button type="button" className="btn small" onClick={() => setStep('video')}>Текст отправлен → к ролику</button>
            <button type="button" className="btn small ghost" onClick={() => setStep(null)}>Отмена</button>
          </span>
        </div>
      )}
      {step === 'video' && (
        <div ref={stepTwo} className="outreach-step big" role="group" aria-label="Шаг 2: ролик">
          <strong>🎬 Теперь ролик</strong>
          <span>{way === 'share' ? 'Нажмите кнопку → WhatsApp → выберите этот чат (он первый в списке).'
            : way === 'telegram' ? 'Ролик откроется в браузере → «Поделиться» → WhatsApp → этот чат (он первый в списке).'
              : 'Файл скачается — прикрепите его в этот чат WhatsApp Web (📎 → «Фото и видео»).'}</span>
          {video === 'retry' && <span className="tone-wait">Ролик загрузился — нажмите ещё раз.</span>}
          <span className="actions">
            <button type="button" className="btn primary" disabled={video === 'pending'} onClick={() => shareVideo(true)}>
              {video === 'pending' ? 'Готовлю ролик…' : way === 'download' ? '🎬 Скачать ролик' : '🎬 Отправить ролик'}</button>
            <button type="button" className="btn ghost" onClick={() => setStep('ask')}>Без ролика</button>
          </span>
        </div>
      )}
      {copied && step !== 'ask' && <span className="tone-ok" role="status">Текст скопирован</span>}
      {video && video !== 'pending' && video !== 'cancelled' && video !== 'retry' && step !== 'done' && (
        <span className="tone-ok" role="status">{VIDEO_DONE[video]}</span>
      )}
      {videoError && <p className="error" role="alert">Ролик не открылся: {videoError}</p>}
      {step === 'ask' && (
        <div className="outreach-ask" role="group" aria-label="Отправили?">
          <span>{copied ? 'Текст скопирован. ' : ''}{ASK[mode](l.clinicName ?? '')}</span>
          <span className="actions">
            <button type="button" className="btn primary small" disabled={busy} onClick={yes}>Да</button>
            <button type="button" className="btn small" onClick={() => setStep(null)}>Нет</button>
            {l.phone && mode === 'video' && (
              <button type="button" className="btn small ghost" onClick={openTemplate}
                title="Третьим сообщением: «Вот шаблон — заполните, и мы всё перенесём»">📥 Ещё и шаблон Excel</button>
            )}
          </span>
        </div>
      )}
      {step === 'done' && (
        <div className="outreach-ask" role="group" aria-label="Отмечено">
          <span className="tone-ok">{DONE[mode](l.clinicName ?? '')}</span>
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
  const [f, setF] = useState({ name: l.clinicName ?? '', phone: phoneToInput(l.phone), address: l.address ?? '', link: l.link ?? '', city: l.city || 'Бишкек' })
  const save = useMutation<OutreachLead, ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/platform/outreach/{id}', {
      params: { path: { id: l.id } },
      body: { clinicName: f.name, phone: phoneFromInput(f.phone), address: f.address, link: f.link, city: f.city },
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
      </div>
      {(err('clinicName') || err('phone')) && <p className="error">{err('clinicName') ?? err('phone')}</p>}
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
        <button type="submit" className="btn primary" disabled={save.isPending || !f.name.trim() || (!f.phone.trim() && !f.link.trim())}>Сохранить</button>
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
  const empty = { name: '', phone: '', address: '', link: '' }
  const [f, setF] = useState(empty)
  const [city, setCity] = useState('Бишкек')
  const set = (k: keyof typeof empty) => (v: string) => { setF({ ...f, [k]: v }); add.reset() }
  const cell = (v: string) => v.replace(/[\t\r\n]+/g, ' ').trim()
  const add = useMutation<Report, ApiError>({
    mutationFn: () => {
      const body = new FormData()
      body.append('text', `Название\tТелефон\tАдрес\tСсылка\n${[f.name, phoneFromInput(f.phone), f.address, f.link].map(cell).join('\t')}`)
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
        <label className="field"><span>Адрес</span><input value={f.address} maxLength={300} onChange={(e) => set('address')(e.target.value)} /></label>
        <label className="field"><span>Ссылка (2ГИС, карты, Instagram)</span>
          <input value={f.link} placeholder="https://…" onChange={(e) => set('link')(e.target.value)} /></label>
        <label className="field"><span>Город</span>
          <Select value={city} onChange={(e) => setCity(e.target.value)}>{CITIES.map((c) => <option key={c} value={c}>{c}</option>)}</Select>
        </label>
      </div>
      <p className="hint">Нужно название и телефон или ссылка.</p>
      <div className="actions">
        <button type="submit" className="btn primary" disabled={add.isPending || !f.name.trim() || (!f.phone.trim() && !f.link.trim())}>Добавить</button>
        <button type="button" className="btn ghost" onClick={onClose}>Закрыть</button>
      </div>
      {r && (r.added ? <p className="tone-ok" role="status">Добавлена «{row?.clinicName}» — она в списке «Не писали».</p>
        : row?.status === 'DUPLICATE' ? <p className="tone-wait" role="status">Этот номер уже в списке{row.message ? ` — ${row.message}` : ''}. Не добавляли.</p>
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
      <p className="hint">Строка — одна клиника: <b>Название; телефон; адрес; ссылка</b> (2ГИС, карты или Instagram). Можно скопировать
        колонки из Excel или Google-таблицы — разделитель «;» или табуляция. Обязательно название и телефон или ссылка.
        Номер можно с кодом страны: +7 701 123 45 67. Клиника — это её номер: кто уже в списке (тот же номер, в том числе заявки
        с сайта), просто пропустим; две клиники с одним названием и разными номерами — разные.</p>
      <p className="hint">Скачать шаблон:{' '}
        <button type="button" className="link" onClick={() => void download('/api/platform/outreach/import/template?format=xlsx', 'клиники-шаблон.xlsx')}>Excel (.xlsx)</button>
        {' · '}
        <button type="button" className="link" onClick={() => void download('/api/platform/outreach/import/template?format=csv', 'клиники-шаблон.csv')}>CSV</button>
        {' '}— колонки «Название, Телефон, Адрес, Ссылка, Город» и строки-примеры.</p>
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
            <thead><tr><th className="r">Строка</th><th>Клиника</th><th>Телефон</th><th>Итог</th></tr></thead>
            <tbody>
              {(r.rows ?? []).map((row) => (
                <tr key={row.line}>
                  <td className="r num">{row.line}</td>
                  <td>{row.clinicName || '—'}{row.address && <span className="hint"> · {row.address}</span>}</td>
                  <td className="nowrap">{row.phone ? formatPhone(row.phone) : row.link ? 'ссылка' : '—'}</td>
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
  const save = useMutation<Template, ApiError, string>({
    mutationFn: (value) => unwrap(api.PUT('/api/platform/outreach/template', { body: { text: value } })),
    onSuccess: (t) => {
      setText(t.text ?? '')
      void client.invalidateQueries({ queryKey: ['platform-outreach'] })
    },
  })
  return (
    <section className="card-block" aria-label="Текст сообщения">
      <details>
        <summary>Текст сообщения{template.custom ? ' (свой)' : ''}</summary>
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
