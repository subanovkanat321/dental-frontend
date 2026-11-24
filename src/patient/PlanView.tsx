import { useState } from 'react'

import type { Schemas } from '../api/client'
import { ContactLinks } from '../lib/ContactLinks'
import { PlanFormula } from '../medical/PlanFormula'
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
  /** variantId — выбранный вариант, если врач прислал несколько (V254) */
  onAgree: (variantId?: number) => void
  onAsk: () => void
  onBook?: () => void
  busy?: boolean
  error?: string | null
}) {
  const variants = plan.variants ?? []
  const choosing = variants.length > 1 && !plan.agreedAt
  const [vid, setVid] = useState<number | null>(null)
  const variant = choosing ? variants.find((v) => v.id === vid) ?? variants[0] : null
  const stages = (variant ? variant.stages : plan.stages) ?? []
  const total = variant ? variant.totalSom : plan.totalSom
  // Скидка этапов (V257): итог — к оплате; цена до скидки — итог + скидка
  const discount = (variant ? variant.discountSom : plan.discountSom) ?? 0
  const chart = variant ? variant.chart : plan.chart
  const agreed = Boolean(plan.agreedAt)
  const [tooth, setTooth] = useState<number | null>(null)
  const label = (n: number, name?: string | null) => `${t('planVariant', { n })}${name ? ` — ${name}` : ''}`
  return (
    <div className="plan-view">
      <h1>{t('planTitle')}</h1>
      {plan.forName && <p className="hint">{t('planFor', { name: plan.forName })}</p>}
      <p className="hint">{[plan.clinicName, plan.doctorName ? t('planDoctor', { name: plan.doctorName }) : null].filter(Boolean).join(' · ')}</p>
      {choosing && (
        <>
          <p className="plan-view-intro">{t('planVariants')}</p>
          <div className="plan-view-variants" role="tablist" aria-label={t('planVariants')}>
            {variants.map((v) => (
              <button key={v.id} type="button" role="tab" aria-selected={v.id === variant!.id} onClick={() => { setVid(v.id); setTooth(null) }}>
                <span>{label(v.number, v.name)}</span>
                <b className="num">{somText(v.totalSom)}</b>
                {v.discountSom ? <span className="hint small">{t('planDiscount')} −{somText(v.discountSom)}</span> : null}
              </button>
            ))}
          </div>
        </>
      )}
      {plan.chosenNumber != null && <p className="tone-ok plan-view-chosen">✅ {t('planChosen', { v: label(plan.chosenNumber, plan.chosenName) })}</p>}
      {chart && <PlanTeeth key={variant?.id ?? 0} chart={chart} t={t} selected={tooth} onSelect={(n) => setTooth((cur) => (cur === n ? null : n))} />}
      <Stages stages={stages} t={t} tooth={tooth} />
      {total > 0 && discount > 0 && (
        <div className="plan-view-total plan-view-discount">
          <p>{variant ? t('planVariantTotal') : t('planTotal')}: <s className="num">{somText(total + discount)}</s></p>
          <p>{t('planDiscount')}: <span className="num">−{somText(discount)}</span></p>
          <p>{t('planWithDiscount')}: <b className="num">{somText(total)}</b></p>
        </div>
      )}
      {total > 0 && discount === 0 && <p className="plan-view-total">{variant ? t('planVariantTotal') : t('planTotal')}: <b className="num">{somText(total)}</b></p>}
      {plan.duration && <p>{t('planDuration', { d: plan.duration })}</p>}
      {plan.validUntil && <p>{t('planValid', { date: day(plan.validUntil) })}</p>}
      <p className="hint small">{t('planNote')}</p>
      {agreed && <p className="tone-ok" role="status">✅ {t('planAgreed', { date: dayOf(plan.agreedAt!) })}</p>}
      {!agreed && plan.questionAt && <p className="hint" role="status">{t('planAsked')}</p>}
      <div className="plan-view-actions">
        {!agreed && (
          <button type="button" className="btn primary" disabled={busy} onClick={() => onAgree(variant?.id)}>
            {variant ? `${t('planChoose')}: ${label(variant.number, variant.name)}` : t('planAgree')}
          </button>
        )}
        {onBook && <button type="button" className={agreed ? 'btn primary' : 'btn'} onClick={onBook}>{t('planBook')}</button>}
        {!agreed && !plan.questionAt && <button type="button" className="btn" disabled={busy} onClick={onAsk}>{t('planAsk')}</button>}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <ContactLinks phones={plan.phones} whatsapp={plan.whatsappPhone} texts={{ call: t('call'), whatsapp: t('writeWhatsapp') }} />
    </div>
  )
}

/** Этапы плана (или выбранного варианта): процедуры, цены, итог за этап; зуб с рисунка — подсвечен. */
function Stages({ stages, t, tooth }: { stages: NonNullable<Plan['stages']>; t: T; tooth: number | null }) {
  const many = stages.length > 1
  return (
    <>
      {stages.map((st) => (
        <section key={st.stage} className="plan-view-stage" aria-label={many ? t('planStage', { n: st.stage }) : t('planWhat')}>
          <h2>{many ? t('planStage', { n: st.stage }) : t('planWhat')}</h2>
          <ul>
            {(st.items ?? []).map((item, i) => (
              <li key={i} className={item.tooth != null && item.tooth === tooth ? 'selected' : undefined}>
                <span>{item.tooth ? <b>{t('planTooth', { n: item.tooth })} · </b> : null}{item.title}</span>
                <span className="num nowrap">{item.priceSom == null ? <span className="hint">{t('planPriceLater')}</span>
                  : item.discountSom ? <><s className="hint">{somText(item.priceSom)}</s> <b>{somText(item.priceSom - item.discountSom)}</b></>
                    : somText(item.priceSom)}</span>
              </li>
            ))}
          </ul>
          {many && st.totalSom > 0 && (
            <p className="plan-view-sub">{t('planStageTotal')}: <b className="num">{somText(st.totalSom)}</b>
              {st.discountSom ? <span className="hint"> ({t('planDiscount').toLowerCase()} −{somText(st.discountSom)})</span> : null}</p>
          )}
        </section>
      ))}
    </>
  )
}

type Chart = NonNullable<Plan['chart']>

/**
 * Зубы плана рисунком — та же формула, что на печатном листе ({@link PlanFormula}): зубы из плана в рамке, их состояние
 * цветом, остальные — здоровыми (остальную карту сервер не отдаёт). Нажал на зуб в рамке — его этапы подсвечены в списке.
 * Сменный прикус: какие постоянные уже стоят вместо молочных — chart.permanent.
 */
function PlanTeeth({ chart, t, selected, onSelect }: { chart: Chart; t: T; selected: number | null; onSelect: (n: number) => void }) {
  const teeth = chart.teeth ?? []
  if (teeth.length === 0) return null
  const stagesOf = new Map(teeth.map((x) => [x.number, x.stages ?? []]))
  const planned = new Set(teeth.map((x) => x.number))
  const charted = [...teeth, ...(chart.permanent ?? []).map((number) => ({ number }))]
  return (
    <div className="plan-view-teeth">
      <h2>{t('planChart')}</h2>
      <PlanFormula dentition={chart.dentition ?? 'PERMANENT'} teeth={teeth} chartTeeth={charted} planned={planned}
        selected={selected} onSelect={onSelect}
        texts={{
          title: t('planChart'),
          planned: t('planChartPlanned'),
          state: (s) => t(`tooth${s}`),
          jaws: [t('planChartUpper'), t('planChartLower')],
          extra: (n) => (stagesOf.get(n)?.length ? stagesOf.get(n)!.map((st) => t('planChartStages', { n: st })).join(', ') : null),
        }} />
      <p className="hint small">{t('planChartHint')}</p>
    </div>
  )
}
