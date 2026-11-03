import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { haptic, openLink } from '../lib/telegram'
import { whatsappUrl } from '../lib/texts'
import { shortDate } from '../lib/time'
import { canPrint, docDate } from './paper'
import { PrintSheet } from './PrintSheet'

type Me = Schemas['BookingViewsMe']
type Appointment = Schemas['AppointmentView']
type Draft = Schemas['VisitReportsDraft']
type Via = NonNullable<Schemas['VisitReportControllerSend']['via']>

const VIA_TEXT: Record<Via, string> = { TELEGRAM: 'в Telegram', WHATSAPP: 'в WhatsApp', PRINT: 'на печать' }

function errorText(e: ApiError | null): string | null {
  return e ? Object.values(e.fieldErrors)[0] ?? e.message : null
}

/**
 * «📝 Отчёт пациенту» у состоявшегося приёма: что сделали простыми словами, уход дома, что дальше и
 * следующий визит — на языке пациента. Черновик пишет ИИ (если клиника включила) или шаблон; врач
 * правит и отправляет сам — в Telegram, WhatsApp или на печать. Только врач приёма и админ (сервер).
 */
export function VisitReport({ appointment: a, me }: { appointment: Appointment; me: Me }) {
  const client = useQueryClient()
  const key = ['visit-report', a.id]
  const last = useQuery<Schemas['VisitReportsSent'] | null, ApiError>({
    queryKey: key,
    queryFn: async () => (await unwrap(api.GET('/api/appointments/{id}/visit-report', { params: { path: { id: a.id! } } }))) ?? null,
    retry: false,
  })
  const [draft, setDraft] = useState<Draft | null>(null)
  const [text, setText] = useState('')
  const [printing, setPrinting] = useState(false)
  const [done, setDone] = useState('')
  const make = useMutation<Draft, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/appointments/{id}/visit-report/draft', { params: { path: { id: a.id! } } })),
    onSuccess: (d) => {
      setDraft(d)
      setText(d.text ?? '')
      setDone('')
    },
  })
  const send = useMutation<Schemas['PatientMessage'] | undefined, ApiError, Via>({
    mutationFn: (via) => unwrap(api.POST('/api/appointments/{id}/visit-report/send', {
      params: { path: { id: a.id! } }, body: { text, ai: draft?.ai ?? false, via },
    })),
    onSuccess: (message, via) => {
      haptic('success')
      setDone(`Отчёт отправлен ${VIA_TEXT[via]}`)
      if (via === 'WHATSAPP' && a.patient?.phone && message?.text) openLink(whatsappUrl(a.patient.phone, message.text))
      if (via === 'PRINT') setPrinting(true)
      void client.invalidateQueries({ queryKey: key })
    },
    onError: () => haptic('error'),
  })
  // 403 — не врач приёма и не админ: блока нет
  if (last.error?.status === 403) return null

  return (
    <section className="visit-report" aria-label="Отчёт пациенту">
      <div className="block-head">
        <h3>Отчёт пациенту</h3>
        {last.data && !draft && (
          <span className="hint small">Отправлен {shortDate(last.data.sentAt!)} {VIA_TEXT[last.data.via!]}</span>
        )}
      </div>
      {!draft ? (
        <>
          <p className="hint">Что сделали — простыми словами, как ухаживать дома, когда следующий визит. Вы проверите текст перед отправкой.</p>
          <button type="button" className="btn" disabled={make.isPending} onClick={() => make.mutate()}>
            {make.isPending ? 'Пишем отчёт…' : last.data ? 'Составить новый' : 'Составить отчёт'}</button>
        </>
      ) : (
        <>
          <p className="hint small">{draft.ai ? '✨ Написал ИИ по данным приёма — проверьте' : 'По шаблону из данных приёма — дополните своими словами'}
            {draft.lang === 'KY' ? ' · на кыргызском, как у пациента в боте' : ''}</p>
          <textarea className="visit-report-text" aria-label="Текст отчёта" rows={12} maxLength={4000} value={text}
            onChange={(e) => setText(e.target.value)} />
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
        <PrintSheet title="Отчёт о приёме" onClose={() => setPrinting(false)}>
          {() => (
            <>
              <h1>Отчёт о приёме</h1>
              <dl>
                <dt>Пациент</dt><dd>{a.patient?.fullName}</dd>
                <dt>Приём</dt><dd>{docDate(a.startAt!)}</dd>
              </dl>
              <div className="memo-body">{text}</div>
            </>
          )}
        </PrintSheet>
      )}
    </section>
  )
}

/**
 * Включить ИИ для отчётов клиники — решает админ: в ИИ уходит только клиническое (услуга, зубы,
 * план, заметка без телефонов), без имени и телефона пациента.
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
    return <p className="hint small">✨ ИИ пишет отчёт понятнее — его может включить администратор клиники.</p>
  }
  return (
    <div className="ai-switch">
      <p className="hint small">✨ ИИ напишет понятнее и на языке пациента. В ИИ уходят только данные приёма — без имени и
        телефона пациента.</p>
      <button type="button" className="btn small" disabled={turn.isPending} onClick={() => turn.mutate()}>Включить ИИ для отчётов клиники</button>
      {turn.error && <p className="error small" role="alert">{errorText(turn.error)}</p>}
    </div>
  )
}
