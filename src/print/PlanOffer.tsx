import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { contactPhone } from '../lib/guardian'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { useMe } from '../api/me'
import { DateInput } from '../layout/DateInput'
import { stagesOf } from '../lib/planStages'
import { haptic, openLink } from '../lib/telegram'
import { whatsappUrl } from '../lib/texts'
import { addDays, formatPhone, shortDate, somText, todayIn } from '../lib/time'
import { canPrint, docDate } from './paper'
import { PrintSheet } from './PrintSheet'

type Step = Schemas['TreatmentStepView']
type Patient = Schemas['PatientView']
type Offer = Schemas['PlanOffersOfferView']
type Channel = NonNullable<Schemas['PlanOffersSendRequest']['channel']>

/** «Отправлен 3 ноя 2026 · согласован 4 ноя 2026» — статус последнего отправленного плана. */
function offerStatus(o: Offer): string {
  const parts = [`Отправлен ${o.sentAt ? shortDate(o.sentAt) : ''}${o.channel === 'WHATSAPP' ? ' в WhatsApp' : ' в Telegram'}`]
  if (o.agreedAt) parts.push(`согласован ${shortDate(o.agreedAt)}`)
  else if (o.questionAt) parts.push(`просит перезвонить (${shortDate(o.questionAt)})`)
  else if (!o.active) parts.push('не согласован, цены истекли')
  else parts.push('ждём ответа')
  if (o.totalSom) parts.push(somText(o.totalSom))
  return parts.join(' · ')
}

/**
 * «Отправить план пациенту» (V140): предпросмотр документа — этапы, зубы, процедуры, цены, итоги по
 * этапам и всего, срок, «цены действительны до», врач и клиника — и отправка: в Telegram (бот с
 * кнопками «Согласен» / «Есть вопрос» / «Записаться на 1-й этап»), в WhatsApp (текст со ссылкой на
 * страницу плана) или печать. Отправляет сервер; здесь — только то, что увидит пациент.
 */
export function PlanOffer({ patient, steps }: { patient: Patient; steps: Step[] }) {
  const patientId = patient.id!
  const offers = useQuery({
    queryKey: ['plan-offers', patientId],
    queryFn: () => unwrap(api.GET('/api/patients/{patientId}/plan/offers', { params: { path: { patientId } } })),
  })
  const [open, setOpen] = useState(false)
  const todo = steps.filter((s) => !s.doneAt)
  const last = offers.data?.[0]
  return (
    <div className="plan-offer">
      {last && <p className={last.agreedAt ? 'tone-ok small' : 'hint small'} aria-label="Статус плана">{offerStatus(last)}</p>}
      {open ? <OfferPanel patient={patient} steps={todo} onClose={() => setOpen(false)} />
        : todo.length > 0 && <button type="button" className="btn" onClick={() => setOpen(true)}>Отправить план пациенту</button>}
    </div>
  )
}

function OfferPanel({ patient, steps, onClose }: { patient: Patient; steps: Step[]; onClose: () => void }) {
  const patientId = patient.id!
  const client = useQueryClient()
  const today = todayIn()
  const [validUntil, setValidUntil] = useState(addDays(today, 30))
  const [duration, setDuration] = useState('')
  const [printing, setPrinting] = useState(false)
  const [done, setDone] = useState('')
  const send = useMutation<Schemas['PlanOffersSent'], ApiError, Channel>({
    mutationFn: (channel) => unwrap(api.POST('/api/patients/{patientId}/plan/offers', {
      params: { path: { patientId } }, body: { channel, validUntil, duration: duration.trim() || undefined },
    })),
    onSuccess: (sent, channel) => {
      haptic('success')
      if (channel === 'WHATSAPP' && contactPhone(patient) && sent.text) openLink(whatsappUrl(contactPhone(patient)!, sent.text))
      setDone(channel === 'TELEGRAM' ? 'План отправлен в Telegram — с кнопками «Согласен» и «Есть вопрос»'
        : 'Открыли WhatsApp — в тексте ссылка на страницу плана с кнопкой «Согласен»')
      void client.invalidateQueries({ queryKey: ['plan-offers', patientId] })
    },
    onError: () => haptic('error'),
  })
  // Бот не смог (нет Telegram, удалил чат) — та же кнопка WhatsApp
  const fallback = send.error?.code === 'not-delivered' && patient.phone
  const error = send.error ? Object.values(send.error.fieldErrors)[0] ?? send.error.message : null
  if (done) {
    return (
      <div className="plan-offer-done">
        <p className="tone-ok" role="status">✅ {done}</p>
        <button type="button" className="btn small" onClick={onClose}>Готово</button>
      </div>
    )
  }
  const telegramFirst = Boolean(patient.telegram)
  return (
    <section className="plan-offer-panel" aria-label="План пациенту">
      <div className="plan-offer-fields">
        <label className="field"><span>Срок лечения, ориентировочно</span>
          <input value={duration} maxLength={100} placeholder="например, 2–3 месяца" onChange={(e) => setDuration(e.target.value)} />
        </label>
        <label className="field"><span>Цены действительны до</span>
          <DateInput aria-label="Цены действительны до" value={validUntil} min={today} max={addDays(today, 180)}
            onChange={(e) => setValidUntil(e.target.value)} />
        </label>
      </div>
      <div className="plan-offer-preview" aria-label="Предпросмотр плана">
        <OfferDoc steps={steps} validUntil={validUntil} duration={duration.trim()} />
      </div>
      <div className="actions">
        {telegramFirst && (
          <button type="button" className="btn primary" disabled={send.isPending} onClick={() => send.mutate('TELEGRAM')}>Отправить в Telegram</button>
        )}
        {patient.phone && (
          <button type="button" className={telegramFirst ? 'btn' : 'btn primary'} disabled={send.isPending}
            onClick={() => send.mutate('WHATSAPP')}>WhatsApp</button>
        )}
        {canPrint() && <button type="button" className="btn" onClick={() => setPrinting(true)}>Печать</button>}
        <button type="button" className="btn ghost" onClick={onClose}>Отмена</button>
      </div>
      {!telegramFirst && !patient.phone && <p className="hint small">Пациент не в Telegram и без телефона — распечатайте план.</p>}
      {error && <p className="error small" role="alert">{error}</p>}
      {fallback && <button type="button" className="btn small" onClick={() => send.mutate('WHATSAPP')}>Отправить в WhatsApp</button>}
      {printing && (
        <PrintSheet title="План лечения" onClose={() => setPrinting(false)}>
          {() => (
            <>
              <h1>План лечения</h1>
              <dl><dt>Пациент</dt><dd>{patient.fullName}</dd></dl>
              <OfferDoc steps={steps} validUntil={validUntil} duration={duration.trim()} print />
              <div className="signatures">
                <span>Врач ____________________</span>
                <span>Пациент ____________________</span>
              </div>
            </>
          )}
        </PrintSheet>
      )}
    </section>
  )
}

/** Документ плана: то же, что получит пациент. Имя пациента — только на печати (лист отдают в руки). */
function OfferDoc({ steps, validUntil, duration, print = false }: { steps: Step[]; validUntil: string; duration: string; print?: boolean }) {
  const me = useMe().data
  const stages = stagesOf(steps)
  const total = stages.reduce((sum, s) => sum + s.total, 0)
  const doctor = (me?.doctors ?? []).find((d) => d.id === me?.doctorId)?.fullName
  const clinic = me?.clinic
  const name = clinic?.brandName || clinic?.name
  const phone = clinic?.phones?.[0] ?? clinic?.whatsappPhone
  return (
    <div className="offer-doc">
      {!print && <h3>Ваш план лечения</h3>}
      <p className="hint small">Дата: {docDate(new Date().toISOString())}{doctor ? ` · Врач: ${doctor}` : ''}</p>
      {stages.map((st) => (
        <div key={st.stage} className="offer-stage">
          <h4>{stages.length > 1 ? `Этап ${st.stage}` : 'Что сделать'}</h4>
          <table aria-label={stages.length > 1 ? `Этап ${st.stage}` : 'Что сделать'}>
            <tbody>
              {st.items.map((s) => (
                <tr key={s.id}>
                  <td>{s.tooth ? `Зуб ${s.tooth}` : '—'}</td>
                  <td>{s.title}</td>
                  <td className="r num">{s.priceSom != null ? somText(s.priceSom) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {stages.length > 1 && st.total > 0 && <p className="offer-subtotal">Итого за этап: <b className="num">{somText(st.total)}</b></p>}
        </div>
      ))}
      {total > 0 && <p className="total">Всего: <span className="num">{somText(total)}</span></p>}
      {duration && <p>Срок лечения: ориентировочно {duration}</p>}
      <p>Цены действительны до {validUntil.split('-').reverse().join('.')}.</p>
      <p className="note">План может меняться по результатам лечения.</p>
      {(name || phone) && <p className="hint small">— {[name, phone ? formatPhone(phone) : null].filter(Boolean).join(', ')}</p>}
    </div>
  )
}
