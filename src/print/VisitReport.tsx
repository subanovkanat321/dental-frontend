import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { contactPhone } from '../lib/guardian'
import { useEffect, useRef, useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { Select } from '../layout/Select'
import { isAssistant } from '../lib/roles'
import { haptic, openLink } from '../lib/telegram'
import { whatsappUrl } from '../lib/texts'
import { shortDate } from '../lib/time'
import { canPrint, docDate } from './paper'
import { PrintSheet } from './PrintSheet'
import { MemoDocs, MemoSheet } from './VisitDocs'
import { ChannelSwitch, MessagePreview, type Channel } from './MessagePreview'
import { Spinner } from '../layout/Loading'

type Me = Schemas['BookingViewsMe']
type Appointment = Schemas['AppointmentView']
type Draft = Schemas['VisitReportsDraft']
type Preview = Schemas['VisitReportsPreview']
type CareMemo = Schemas['CareMemosAppointmentMemo']
type Via = NonNullable<Schemas['VisitReportControllerSend']['via']>

const VIA_TEXT: Record<Via, string> = { TELEGRAM: 'в Telegram', WHATSAPP: 'в WhatsApp', PRINT: 'на печать' }

function errorText(e: ApiError | null): string | null {
  return e ? Object.values(e.fieldErrors)[0] ?? e.message : null
}

/**
 * «Сообщение после приёма» у состоявшегося приёма — одно вместо отчёта и памятки. Личная часть (что
 * сделали, что дальше, следующий визит, когда звонить) — ИИ или шаблон, врач правит. «Уход дома» —
 * памятка клиники к услуге дословно: ИИ её не пишет; поправить можно только в этом сообщении.
 * Начать — «Написать самому» (без ИИ) или «Составить с ИИ» (по шаблону, если ИИ у клиники выключен); перед
 * отправкой — предпросмотр точного текста с сервера (заголовок, текст, уход, подпись «Врач… / Клиника…»).
 * Врач приёма и админ (сервер). Регистратуре и ассистенту — памятка отдельно, как раньше.
 */
export function AfterVisit({ appointment: a, me }: { appointment: Appointment; me: Me }) {
  const last = useQuery<Schemas['VisitReportsSent'] | null, ApiError>({
    queryKey: ['visit-report', a.id],
    queryFn: async () => (await unwrap(api.GET('/api/appointments/{id}/visit-report', { params: { path: { id: a.id } } }))) ?? null,
    retry: false,
    enabled: !isAssistant(me),
  })
  // Не врач приёма и не админ (403) — только памятка: отправлять её регистратура может, как раньше
  if (isAssistant(me) || last.error?.status === 403) {
    return (
      <section className="visit-docs" aria-label="Памятка пациенту">
        <MemoDocs appointment={a} />
      </section>
    )
  }
  if (last.isPending) return null
  return <AfterVisitMessage appointment={a} me={me} last={last.data ?? null} />
}

type Mode = 'SELF' | 'AI' | 'TEMPLATE'

/** «Указать мой номер» в подписи — выбор врача на этом устройстве: только флаг, сам номер не храним. */
const PHONE_FLAG = 'visit-report-doctor-phone'

function phoneFlag(): boolean {
  try {
    return localStorage.getItem(PHONE_FLAG) !== '0'
  }
  catch {
    return true
  }
}

function savePhoneFlag(on: boolean) {
  try {
    localStorage.setItem(PHONE_FLAG, on ? '1' : '0')
  }
  catch {
    // приватный режим — просто не запомним
  }
}

/**
 * Три шага: «с чего начать» (написать самому / составить с ИИ или по шаблону) → редактор → «Так увидит
 * пациент» (точный текст с сервера) → «Отправить». Памятку можно отправить и одну, без сообщения;
 * печать — второстепенно, ссылкой.
 */
function AfterVisitMessage({ appointment: a, me, last }: { appointment: Appointment; me: Me; last: Schemas['VisitReportsSent'] | null }) {
  const client = useQueryClient()
  const id = a.id
  const phone = contactPhone(a.patient)
  // Памятка услуги — до черновика: показать, что уйдёт в «Уход дома», и отправить её одну
  const memo = useQuery({
    queryKey: ['care-memo', id, null],
    queryFn: () => unwrap(api.GET('/api/appointments/{id}/care-memo', { params: { path: { id } } })),
    retry: false,
  })
  const ai = useQuery({ queryKey: ['visit-report-ai'], queryFn: () => unwrap(api.GET('/api/clinic/visit-report-ai')), retry: false })
  const aiOn = Boolean(ai.data?.on)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [mode, setMode] = useState<Mode>('TEMPLATE')
  const [text, setText] = useState('')
  const [care, setCare] = useState('')
  const [careTitle, setCareTitle] = useState<string | null>(null)
  const [withPhone, setWithPhone] = useState(phoneFlag)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [channel, setChannel] = useState<Channel>('TELEGRAM')
  const [printing, setPrinting] = useState(false)
  const [memoPrinting, setMemoPrinting] = useState(false)
  const [memoSending, setMemoSending] = useState(false)
  const [done, setDone] = useState('')
  const textArea = useRef<HTMLTextAreaElement>(null)
  const make = useMutation<Draft, ApiError, Mode>({
    mutationFn: (m) => unwrap(api.POST('/api/appointments/{id}/visit-report/draft', { params: { path: { id }, query: { mode: m } } })),
    onSuccess: (d, m) => {
      setMode(m)
      setDraft(d)
      setText(d.text ?? '')
      setCare(d.care?.text ?? '')
      setCareTitle(d.care?.title ?? null)
      setPreview(null)
      setDone('')
    },
  })
  // «Написать самому» — курсор сразу под приветствием: там пустая строка для своих слов
  useEffect(() => {
    if (draft && mode === 'SELF' && textArea.current) {
      const at = (draft.text ?? '').indexOf('\n\n')
      textArea.current.focus()
      if (at >= 0) textArea.current.setSelectionRange(at + 2, at + 2)
    }
  }, [draft, mode])
  const body = { text, care: care.trim() ? care : undefined, doctorPhone: draft?.doctorPhone ? withPhone : false }
  const check = useMutation<Preview, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/appointments/{id}/visit-report/preview', { params: { path: { id } }, body })),
    onSuccess: (p) => {
      setPreview(p)
      setChannel(p.telegram ? 'TELEGRAM' : 'WHATSAPP')
    },
  })
  const send = useMutation<Schemas['PatientMessage'] | undefined, ApiError, Via>({
    mutationFn: (via) => unwrap(api.POST('/api/appointments/{id}/visit-report/send', {
      params: { path: { id } }, body: { ...body, ai: draft?.ai ?? false, via },
    })),
    onSuccess: (message, via) => {
      haptic('success')
      setDone(`Сообщение отправлено ${VIA_TEXT[via]}`)
      if (via === 'WHATSAPP' && phone && message?.text) openLink(whatsappUrl(phone, message.text))
      if (via === 'PRINT') setPrinting(true)
      else {
        setDraft(null)
        setPreview(null)
      }
      void client.invalidateQueries({ queryKey: ['visit-report', id] })
    },
    onError: () => haptic('error'),
  })
  const m = memo.data
  const careHeading = draft?.lang === 'KY' ? 'Үйдө кам көрүү' : 'Уход дома'
  const own = a.doctorId != null && a.doctorId === me.doctorId
  const busy = send.isPending || check.isPending
  const fallback = send.error?.code === 'not-delivered' && phone

  return (
    <section className="visit-report" aria-label="Сообщение после приёма">
      <div className="block-head">
        <h3>Сообщение после приёма</h3>
        {last && !draft && <span className="hint small">Отправлено {shortDate(last.sentAt!)} {VIA_TEXT[last.via!]}</span>}
      </div>
      {!draft ? (
        <>
          <p className="hint small">Что сделали и что дальше по плану{m?.memoId != null ? <>, уход дома — из памятки «{m.title}»</> : null}.
            Перед отправкой покажем, что именно получит пациент.</p>
          {m && m.memoId == null && <NoMemo />}
          <div className="after-visit-start">
            <div className="after-visit-way">
              <button type="button" className="btn" disabled={make.isPending} onClick={() => make.mutate('SELF')}>Написать самому</button>
              <span className="hint small">Приветствие и план лечения уже вставлены — остальное своими словами. Без ИИ.</span>
            </div>
            <div className="after-visit-way">
              <button type="button" className="btn" disabled={make.isPending} onClick={() => make.mutate(aiOn ? 'AI' : 'TEMPLATE')}>
                {make.isPending && make.variables !== 'SELF' ? <><Spinner />{aiOn ? 'ИИ пишет…' : 'Составляем…'}</> : aiOn ? 'Составить с ИИ ✨' : 'Составить по шаблону'}</button>
              <span className="hint small">{aiOn
                ? 'ИИ напишет по данным приёма — без имени и телефона пациента. Вы проверите и поправите.'
                : 'Готовый текст из данных приёма: что сделали, план, следующий визит. Вы дополните.'}</span>
            </div>
          </div>
          {m?.memoId != null && (
            <MemoOnly appointment={a} memo={m} sending={memoSending} onSending={setMemoSending} onPrint={() => setMemoPrinting(true)} />
          )}
        </>
      ) : preview ? (
        <>
          <p className="hint small">Так увидит пациент{preview.lang === 'KY' ? ' · на кыргызском, как у него в боте' : ''}. Проверьте и отправьте.</p>
          <ChannelSwitch value={channel} telegram={preview.telegram} whatsapp={Boolean(phone)} onChange={setChannel} />
          <MessagePreview text={preview.text ?? ''} channel={channel} parts={preview.parts} />
          <div className="actions">
            {channel === 'TELEGRAM' && preview.telegram && (
              <button type="button" className="btn primary" disabled={busy} onClick={() => send.mutate('TELEGRAM')}>Отправить в Telegram</button>
            )}
            {(channel === 'WHATSAPP' || !preview.telegram) && phone && (
              <button type="button" className="btn primary" disabled={busy} onClick={() => send.mutate('WHATSAPP')}>Отправить в WhatsApp</button>
            )}
            <button type="button" className="btn ghost" disabled={busy} onClick={() => setPreview(null)}>Изменить</button>
          </div>
          {!preview.telegram && !phone && <p className="hint small">Пациент не в Telegram и без телефона — отправить некуда, можно распечатать.</p>}
          {fallback && <button type="button" className="btn small" onClick={() => send.mutate('WHATSAPP')}>Отправить в WhatsApp</button>}
          {canPrint() && (
            <p className="hint small">Ещё: <button type="button" className="link" disabled={busy} onClick={() => send.mutate('PRINT')}>распечатать</button></p>
          )}
        </>
      ) : (
        <>
          <p className="hint small">{mode === 'SELF' ? 'Своими словами — приветствие и план лечения уже вставлены'
            : draft.ai ? '✨ Написал ИИ по данным приёма — проверьте' : 'По шаблону из данных приёма — дополните своими словами'}
            {draft.lang === 'KY' ? ' · пациент читает на кыргызском' : ''}</p>
          <textarea ref={textArea} className="visit-report-text" aria-label="Текст сообщения" rows={10} maxLength={4000} value={text}
            placeholder="Что сделали сегодня, что дальше, когда позвонить…" onChange={(e) => setText(e.target.value)} />
          {draft.care ? (
            <div className="after-visit-care">
              <p className="line-edit">
                <span><b>{careHeading}</b> — памятка «{careTitle}»</span>
                {care !== draft.care.text && careTitle === draft.care.title && (
                  <button type="button" className="link" onClick={() => setCare(draft.care?.text ?? '')}>вернуть текст памятки</button>
                )}
              </p>
              <textarea className="visit-report-text" aria-label="Уход дома" rows={8} maxLength={4000} value={care}
                onChange={(e) => setCare(e.target.value)} />
              <p className="hint small">Правка — только в этом сообщении; текст памятки клиники не меняется.</p>
            </div>
          ) : (
            <OtherMemo appointment={a} onPick={(memoId, title, text) => { setCareTitle(title); setCare(text); setDraft({ ...draft, care: { memoId, title, text } }) }} />
          )}
          {draft.doctorPhone && (
            <label className="check">
              <input type="checkbox" checked={withPhone} onChange={(e) => { setWithPhone(e.target.checked); savePhoneFlag(e.target.checked) }} />
              <span>{own ? 'Указать мой номер' : 'Указать номер врача'} в подписи · <span className="num">{draft.doctorPhone}</span></span>
            </label>
          )}
          <div className="actions">
            <button type="button" className="btn primary" disabled={busy || !text.trim()} onClick={() => check.mutate()}>
              {check.isPending && <Spinner />}Проверить и отправить</button>
            <button type="button" className="btn ghost" onClick={() => setDraft(null)}>Отмена</button>
          </div>
          {!draft.ai && mode !== 'SELF' && draft.aiAvailable && !aiOn && <AiSwitch me={me} onOn={() => make.mutate('AI')} />}
        </>
      )}
      {done && <p className="tone-ok" role="status">{done}</p>}
      {(make.error ?? check.error ?? send.error) && <p className="error" role="alert">{errorText(make.error ?? check.error ?? send.error)}</p>}
      {printing && (
        <PrintSheet title="После приёма" onClose={() => setPrinting(false)}>
          {() => (
            <>
              <h1>После приёма</h1>
              <dl>
                <dt>Пациент</dt><dd>{a.patient.fullName}</dd>
                <dt>Приём</dt><dd>{docDate(a.startAt)}</dd>
              </dl>
              <div className="memo-body">{text}</div>
              {care.trim() && (
                <>
                  <h2>{careHeading}</h2>
                  <div className="memo-body">{care}</div>
                </>
              )}
            </>
          )}
        </PrintSheet>
      )}
      {memoPrinting && m?.memoId != null && (
        <MemoSheet appointment={a} memo={m} onClose={() => setMemoPrinting(false)} />
      )}
    </section>
  )
}

/**
 * Только памятка, без сообщения: главное — «Отправить памятку пациенту» (Telegram, если пациент пишет боту,
 * иначе WhatsApp; язык пациента), сначала — как она придёт. Печать — второстепенно: «Ещё: распечатать».
 * Тот же отправитель памяток, что у регистратуры (POST …/care-memo/send).
 */
function MemoOnly({ appointment: a, memo: m, sending, onSending, onPrint }: {
  appointment: Appointment; memo: CareMemo; sending: boolean; onSending: (on: boolean) => void; onPrint: () => void
}) {
  const phone = contactPhone(a.patient)
  const [channel, setChannel] = useState<Channel>(m.telegram ? 'TELEGRAM' : 'WHATSAPP')
  const [sent, setSent] = useState('')
  const bot = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/appointments/{id}/care-memo/send', { params: { path: { id: a.id } }, body: { memoId: m.memoId, lang: m.lang } })),
    onSuccess: () => {
      haptic('success')
      setSent('Памятка отправлена в Telegram')
      onSending(false)
    },
    onError: () => haptic('error'),
  })
  const whatsapp = () => {
    if (phone && m.text) {
      openLink(whatsappUrl(phone, m.text))
      setSent('Памятка открыта в WhatsApp — отправьте там')
      onSending(false)
    }
  }
  const nowhere = !m.telegram && !phone
  return (
    <div className="after-visit-memo">
      <p className="line-edit"><span>Или только памятка «{m.title}»</span></p>
      {!sending ? (
        <div className="actions">
          <button type="button" className="btn" disabled={nowhere} onClick={() => { setSent(''); onSending(true) }}>Отправить памятку пациенту</button>
          {canPrint() && <span className="hint small">Ещё: <button type="button" className="link" onClick={onPrint}>распечатать</button></span>}
        </div>
      ) : (
        <>
          <ChannelSwitch value={channel} telegram={Boolean(m.telegram)} whatsapp={Boolean(phone)} onChange={setChannel} />
          <MessagePreview text={m.text ?? ''} channel={channel} label="Предпросмотр памятки" />
          <div className="actions">
            {channel === 'TELEGRAM' && m.telegram
              ? <button type="button" className="btn primary" disabled={bot.isPending} onClick={() => bot.mutate()}>Отправить в Telegram</button>
              : <button type="button" className="btn primary" disabled={!phone} onClick={whatsapp}>Отправить в WhatsApp</button>}
            <button type="button" className="btn ghost" onClick={() => onSending(false)}>Отмена</button>
          </div>
        </>
      )}
      {nowhere && <p className="hint small">Пациент не в Telegram и без телефона — памятку можно только распечатать.</p>}
      {sent && <p className="tone-ok small" role="status">{sent}</p>}
      {bot.error && <p className="error small" role="alert">{bot.error.message}</p>}
      {bot.error?.code === 'not-delivered' && phone && <button type="button" className="btn small" onClick={whatsapp}>Отправить в WhatsApp</button>}
    </div>
  )
}

/** У услуги нет памятки — блока «Уход дома» нет; где её поставить. */
function NoMemo() {
  return (
    <p className="hint small">У услуги нет памятки — <a href="#/clinic/services">выбрать в «Услугах и ценах»</a>.</p>
  )
}

/** Нет памятки у услуги — можно взять другую для этого сообщения. */
function OtherMemo({ appointment: a, onPick }: { appointment: Appointment; onPick: (memoId: number, title: string, body: string) => void }) {
  const all = useQuery({ queryKey: ['care-memos'], queryFn: () => unwrap(api.GET('/api/care-memos')) })
  const [error, setError] = useState<string | null>(null)
  const pick = async (memoId: number) => {
    try {
      // Текст — с сервера: в нём телефон клиники вместо {телефон}
      const m = await unwrap(api.GET('/api/appointments/{id}/care-memo', { params: { path: { id: a.id }, query: { memoId } } }))
      if (m.memoId != null) onPick(m.memoId, m.title!, m.body!)
    }
    catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не получилось')
    }
  }
  const options = (all.data ?? []).filter((x) => x.active !== false)
  return (
    <div className="after-visit-care">
      <NoMemo />
      {options.length > 0 && (
        <Select aria-label="Уход дома из памятки" value="" onChange={(e) => { if (e.target.value) void pick(Number(e.target.value)) }}>
          <option value="">Взять уход из памятки…</option>
          {options.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
        </Select>
      )}
      {error && <p className="error small" role="alert">{error}</p>}
    </div>
  )
}

/**
 * Включить ИИ для отчётов клиники — решает админ: в ИИ уходит только клиническое (услуга, зубы,
 * план, заметка без телефонов), без имени и телефона пациента. Памятка в ИИ не уходит.
 */
function AiSwitch({ me, onOn }: { me: Me; onOn: () => void }) {
  const client = useQueryClient()
  const turn = useMutation<Schemas['VisitReportControllerAiSetting'], ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/clinic/visit-report-ai', { body: { on: true } })),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['visit-report-ai'] })
      onOn()
    },
  })
  if (!me.admin && !me.platform) {
    return <p className="hint small">✨ ИИ пишет сообщение понятнее — его может включить руководитель клиники.</p>
  }
  return (
    <div className="ai-switch">
      <p className="hint small">✨ ИИ напишет понятнее и на языке пациента. В ИИ уходят только данные приёма — без имени и
        телефона пациента; уход дома — всегда ваша памятка. Разбор диктовки включается отдельно: «Настройки → ИИ в клинике».</p>
      <button type="button" className="btn small" disabled={turn.isPending} onClick={() => turn.mutate()}>Включить ИИ для отчётов клиники</button>
      {turn.error && <p className="error small" role="alert">{turn.error.message}</p>}
    </div>
  )
}
