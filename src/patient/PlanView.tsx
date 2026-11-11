import type { Schemas } from '../api/client'
import { ContactLinks } from '../lib/ContactLinks'
import { somText, ZONE } from '../lib/time'
import type { T } from './i18n'
import './planView.css'

type Plan = Schemas['PlanOffersPatientPlan']

/** '2026-12-03' → «03.12.2026». */
const day = (date: string) => date.split('-').reverse().join('.')

/** Момент UTC → «04.11.2026» по Бишкеку. */
const dayOf = (instant: string) =>
  new Intl.DateTimeFormat('ru-RU', { timeZone: ZONE, day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(instant))

/**
 * План лечения глазами пациента (V140): этапы, процедуры и цены, итоги, срок и «цены действительны
 * до», кнопки «Согласен» / «Есть вопрос» / «Записаться на 1-й этап». Один и тот же вид в Mini App
 * (PatientApp) и на странице по ссылке из WhatsApp (site/PlanPage) — запросы делает тот, кто вставил.
 *
 * @param onBook нет — кнопки записи нет (на странице по ссылке записываются в боте или по телефону)
 */
export function PlanView({ plan, t, onAgree, onAsk, onBook, busy = false, error }: {
  plan: Plan
  t: T
  onAgree: () => void
  onAsk: () => void
  onBook?: () => void
  busy?: boolean
  error?: string | null
}) {
  const stages = plan.stages ?? []
  const many = stages.length > 1
  const agreed = Boolean(plan.agreedAt)
  return (
    <div className="plan-view">
      <h1>{t('planTitle')}</h1>
      {plan.forName && <p className="hint">{t('planFor', { name: plan.forName })}</p>}
      <p className="hint">{[plan.clinicName, plan.doctorName ? t('planDoctor', { name: plan.doctorName }) : null].filter(Boolean).join(' · ')}</p>
      {stages.map((st) => (
        <section key={st.stage} className="plan-view-stage" aria-label={many ? t('planStage', { n: st.stage ?? 1 }) : t('planWhat')}>
          <h2>{many ? t('planStage', { n: st.stage ?? 1 }) : t('planWhat')}</h2>
          <ul>
            {(st.items ?? []).map((item, i) => (
              <li key={i}>
                <span>{item.tooth ? <b>{t('planTooth', { n: item.tooth })} · </b> : null}{item.title}</span>
                <span className="num nowrap">{item.priceSom != null ? somText(item.priceSom) : <span className="hint">{t('planPriceLater')}</span>}</span>
              </li>
            ))}
          </ul>
          {many && (st.totalSom ?? 0) > 0 && <p className="plan-view-sub">{t('planStageTotal')}: <b className="num">{somText(st.totalSom!)}</b></p>}
        </section>
      ))}
      {(plan.totalSom ?? 0) > 0 && <p className="plan-view-total">{t('planTotal')}: <b className="num">{somText(plan.totalSom!)}</b></p>}
      {plan.duration && <p>{t('planDuration', { d: plan.duration })}</p>}
      {plan.validUntil && <p>{t('planValid', { date: day(plan.validUntil) })}</p>}
      <p className="hint small">{t('planNote')}</p>
      {agreed && <p className="tone-ok" role="status">✅ {t('planAgreed', { date: dayOf(plan.agreedAt!) })}</p>}
      {!agreed && plan.questionAt && <p className="hint" role="status">{t('planAsked')}</p>}
      <div className="plan-view-actions">
        {!agreed && <button type="button" className="btn primary" disabled={busy} onClick={onAgree}>{t('planAgree')}</button>}
        {onBook && <button type="button" className={agreed ? 'btn primary' : 'btn'} onClick={onBook}>{t('planBook')}</button>}
        {!agreed && !plan.questionAt && <button type="button" className="btn" disabled={busy} onClick={onAsk}>{t('planAsk')}</button>}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <ContactLinks phones={plan.phones} whatsapp={plan.whatsappPhone} texts={{ call: t('call'), whatsapp: t('writeWhatsapp') }} />
    </div>
  )
}
