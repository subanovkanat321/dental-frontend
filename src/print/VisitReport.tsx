import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { contactPhone } from '../lib/guardian'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { Select } from '../layout/Select'
import { isAssistant } from '../lib/roles'
import { haptic, openLink } from '../lib/telegram'
import { whatsappUrl } from '../lib/texts'
import { shortDate } from '../lib/time'
import { canPrint, docDate } from './paper'
import { PrintSheet } from './PrintSheet'
import { MemoDocs, MemoSheet } from './VisitDocs'
import { Spinner } from '../layout/Loading'

type Me = Schemas['BookingViewsMe']
type Appointment = Schemas['AppointmentView']
type Draft = Schemas['VisitReportsDraft']
type Via = NonNullable<Schemas['VisitReportControllerSend']['via']>

const VIA_TEXT: Record<Via, string> = { TELEGRAM: 'в Telegram', WHATSAPP: 'в WhatsApp', PRINT: 'на печать' }

function errorText(e: ApiError | null): string | null {
  return e ? Object.values(e.fieldErrors)[0] ?? e.message : null
}

/**
 * «Сообщение после приёма» у состоявшегося приёма — одно вместо отчёта и памятки. Личная часть (что
 * сделали, что дальше, следующий визит, когда звонить) — ИИ или шаблон, врач правит. «Уход дома» —
 * памятка клиники к услуге дословно: ИИ её не пишет; поправить можно только в этом сообщении.
 * Врач приёма и админ (сервер). Регистратуре и ассистенту — памятка отдельно, как раньше.
 */
export function AfterVisit({ appointment: a, me }: { appointment: Appointment; me: Me }) {
  const last = useQuery<Schemas['VisitReportsSent'] | null, ApiError>({
    queryKey: ['visit-report', a.id],
    queryFn: async () => (await unwrap(api.GET('/api/appointments/{id}/visit-report', { params: { path: { id: a.id! } } }))) ?? null,
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

function AfterVisitMessage({ appointment: a, me, last }: { appointment: Appointment; me: Me; last: Schemas['VisitReportsSent'] | null }) {
  const client = useQueryClient()
  const id = a.id!
  // Памятка услуги — до черновика: показать, что уйдёт в «Уход дома», и распечатать её отдельно
  const memo = useQuery({
    queryKey: ['care-memo', id, null],
    queryFn: () => unwrap(api.GET('/api/appointments/{id}/care-memo', { params: { path: { id } } })),
    retry: false,
  })
  const [draft, setDraft] = useState<Draft | null>(null)
  const [text, setText] = useState('')
  const [care, setCare] = useState('')
  const [careTitle, setCareTitle] = useState<string | null>(null)
  const [printing, setPrinting] = useState(false)
  const [memoPrinting, setMemoPrinting] = useState(false)
  const [done, setDone] = useState('')
  const make = useMutation<Draft, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/appointments/{id}/visit-report/draft', { params: { path: { id } } })),
    onSuccess: (d) => {
      setDraft(d)
      setText(d.text ?? '')
      setCare(d.care?.text ?? '')
      setCareTitle(d.care?.title ?? null)
      setDone('')
    },
  })
  const send = useMutation<Schemas['PatientMessage'] | undefined, ApiError, Via>({
    mutationFn: (via) => unwrap(api.POST('/api/appointments/{id}/visit-report/send', {
      params: { path: { id } }, body: { text, care: care.trim() ? care : undefined, ai: draft?.ai ?? false, via },
    })),
    onSuccess: (message, via) => {
      haptic('success')
      setDone(`Сообщение отправлено ${VIA_TEXT[via]}`)
      if (via === 'WHATSAPP' && contactPhone(a.patient) && message?.text) openLink(whatsappUrl(contactPhone(a.patient)!, message.text))
      if (via === 'PRINT') setPrinting(true)
      void client.invalidateQueries({ queryKey: ['visit-report', id] })
    },
    onError: () => haptic('error'),
  })
  const m = memo.data
  const careHeading = draft?.lang === 'KY' ? 'Үйдө кам көрүү' : 'Уход дома'

  return (
    <section className="visit-report" aria-label="Сообщение после приёма">
      <div className="block-head">
        <h3>Сообщение после приёма</h3>
        {last && !draft && <span className="hint small">Отправлено {shortDate(last.sentAt!)} {VIA_TEXT[last.via!]}</span>}
      </div>
      {!draft ? (
        <>
          <p className="hint small">Что сделали и что дальше{m?.memoId != null ? <>, уход дома — из памятки «{m.title}»</> : null}. Проверите перед отправкой.</p>
          {m && m.memoId == null && <NoMemo />}
          <button type="button" className="btn" disabled={make.isPending} onClick={() => make.mutate()}>
            {make.isPending ? <><Spinner />Пишем сообщение…</> : last ? 'Составить новое' : 'Составить сообщение'}</button>
          {m?.memoId != null && canPrint() && (
            <p><button type="button" className="link" onClick={() => setMemoPrinting(true)}>Распечатать только памятку</button></p>
          )}
        </>
      ) : (
        <>
          <p className="hint small">{draft.ai ? '✨ Написал ИИ по данным приёма — проверьте' : 'По шаблону из данных приёма — дополните своими словами'}
            {draft.lang === 'KY' ? ' · на кыргызском, как у пациента в боте' : ''}</p>
          <textarea className="visit-report-text" aria-label="Текст сообщения" rows={10} maxLength={4000} value={text}
            onChange={(e) => setText(e.target.value)} />
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
            <OtherMemo appointment={a} onPick={(title, body) => { setCareTitle(title); setCare(body); setDraft({ ...draft, care: { title, text: body } }) }} />
          )}
          <div className="actions">
            {draft.telegram && (
              <button type="button" className="btn primary" disabled={send.isPending || !text.trim()} onClick={() => send.mutate('TELEGRAM')}>
                📤 Отправить в Telegram</button>
            )}
            {a.patient?.phone && (
              <button type="button" className={draft.telegram ? 'btn' : 'btn primary'} disabled={send.isPending || !text.trim()}
                onClick={() => send.mutate('WHATSAPP')}>WhatsApp</button>
            )}
            {canPrint() && <button type="button" className="btn" disabled={send.isPending || !text.trim()} onClick={() => send.mutate('PRINT')}>🖨 Печать</button>}
            <button type="button" className="btn ghost" onClick={() => setDraft(null)}>Отмена</button>
          </div>
          {!draft.ai && draft.aiAvailable && <AiSwitch me={me} onOn={() => make.mutate()} />}
        </>
      )}
      {done && <p className="tone-ok" role="status">{done}</p>}
      {(make.error ?? send.error) && <p className="error" role="alert">{errorText(make.error ?? send.error)}</p>}
      {printing && (
        <PrintSheet title="После приёма" onClose={() => setPrinting(false)}>
          {() => (
            <>
              <h1>После приёма</h1>
              <dl>
                <dt>Пациент</dt><dd>{a.patient?.fullName}</dd>
                <dt>Приём</dt><dd>{docDate(a.startAt!)}</dd>
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

/** У услуги нет памятки — блока «Уход дома» нет; где её поставить. */
function NoMemo() {
  return (
    <p className="hint small">У услуги нет памятки — <a href="#/clinic/services">выбрать в «Услугах и ценах»</a>.</p>
  )
}

/** Нет памятки у услуги — можно взять другую для этого сообщения. */
function OtherMemo({ appointment: a, onPick }: { appointment: Appointment; onPick: (title: string, body: string) => void }) {
  const all = useQuery({ queryKey: ['care-memos'], queryFn: () => unwrap(api.GET('/api/care-memos')) })
  const [error, setError] = useState<string | null>(null)
  const pick = async (memoId: number) => {
    try {
      // Текст — с сервера: в нём телефон клиники вместо {телефон}
      const m = await unwrap(api.GET('/api/appointments/{id}/care-memo', { params: { path: { id: a.id! }, query: { memoId } } }))
      if (m.memoId != null) onPick(m.title!, m.body!)
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
        телефона пациента; уход дома — всегда ваша памятка. Разбор диктовки включается отдельно: «Настройки → ИИ-помощник».</p>
      <button type="button" className="btn small" disabled={turn.isPending} onClick={() => turn.mutate()}>Включить ИИ для отчётов клиники</button>
      {turn.error && <p className="error small" role="alert">{turn.error.message}</p>}
    </div>
  )
}
