import type { Schemas } from '../api/client'
import { somText } from '../lib/time'
import { discountAmount, percentText, priceOf, QUICK_PERCENTS, setDiscount, typePrice, type PriceDraft } from './stepDiscount'
import './plan.css'

type Policy = Schemas['DiscountPoliciesPolicy']

/**
 * Цена этапа и скидка (V257 бэкенда) — в листе «Что сделать» и в правке этапа. Поле «Цена» — что пациент заплатит за зуб:
 * вписали меньше цены прайса — это скидка на разницу («Цена по прайсу 4 000 → 2 500 сом, скидка 1 500 сом (−37,5 %)»); выше
 * прайса — просто цена. «Скидка: % / сом» и кнопки 5/10/15/20 % пересчитывают цену. Кому скидку давать нельзя или больше
 * его предела («Настройки → Скидки») — подсказка, и сохраним просто цену этапа, как раньше: решает руководитель.
 *
 * @param each подпись поля: «Цена за зуб» для нескольких зубов
 * @param listPrice цена услуги в прайсе сейчас — для старого этапа без скидки: «В прайсе сейчас 4 000 — оформить разницу скидкой?»
 */
export function StepPrice({ value, onChange, policy, label = 'Цена', inputLabel = 'Цена, сом', listPrice }: {
  value: PriceDraft
  inputLabel?: string
  onChange: (d: PriceDraft) => void
  policy?: Policy
  label?: string
  listPrice?: number | null
}) {
  const money = priceOf(value, policy)
  const price = value.price === '' ? null : Number(value.price)
  const canGive = Boolean(policy?.canGive)
  const max = policy?.myMaxPercent ?? 100
  const d = value.discount
  // Старый этап: цена ниже нынешнего прайса, а скидки нет — предложить одной кнопкой (сами не переделываем: прайс мог измениться)
  const legacy = listPrice != null && value.ref == null && price != null && price < listPrice
  const off = value.ref != null ? discountAmount(value.ref, d) : 0
  return (
    <div className="step-price">
      <label className="field"><span>{label}</span>
        <input aria-label={inputLabel} placeholder="сом" type="number" min={0} inputMode="numeric" value={value.price}
          onChange={(e) => onChange(typePrice(value, e.target.value))} />
      </label>
      {canGive && price != null && price > 0 && (
        <div className="step-discount" role="group" aria-label="Скидка этапа">
          <span className="hint small">Скидка:</span>
          {QUICK_PERCENTS.filter((p) => p <= max).map((p) => (
            <button key={p} type="button" className="chip" aria-pressed={d?.kind === 'percent' && d.value === p}
              onClick={() => onChange(setDiscount(value, d?.kind === 'percent' && d.value === p ? null : { kind: 'percent', value: p }))}>{p} %</button>
          ))}
          <span className="step-discount-own">
            <input type="number" min={1} inputMode="numeric" aria-label={d?.kind === 'som' ? 'Скидка, сом' : 'Скидка, %'}
              placeholder={d?.kind === 'som' ? 'сом' : '%'} className="step-discount-value"
              value={d && !(d.kind === 'percent' && QUICK_PERCENTS.includes(d.value)) ? String(d.value) : ''}
              onChange={(e) => onChange(setDiscount(value, e.target.value ? { kind: d?.kind ?? 'percent', value: Number(e.target.value) } : null))} />
            <span className="segments" role="group" aria-label="Скидка в">
              <button type="button" aria-pressed={d?.kind !== 'som'} onClick={() => d && onChange(setDiscount(value, { kind: 'percent', value: d.kind === 'percent' ? d.value : Math.round((off / (value.ref ?? 1)) * 100) }))}>%</button>
              <button type="button" aria-pressed={d?.kind === 'som'} onClick={() => d && onChange(setDiscount(value, { kind: 'som', value: off }))}>сом</button>
            </span>
          </span>
          {d && <button type="button" className="link small" onClick={() => onChange(setDiscount(value, null))}>Убрать</button>}
        </div>
      )}
      {value.ref != null && off > 0 && (
        <p className={money.blocked ? 'step-price-note muted' : 'step-price-note'} role="note" aria-label="Скидка этапа">
          🏷 {d?.kind === 'percent' ? 'Цена до скидки' : 'Цена по прайсу'} <s className="num">{somText(value.ref)}</s> → <b className="num">{somText(value.ref - off)}</b>,
          скидка {somText(off)} (−{d?.kind === 'percent' ? d.value : percentText(off, value.ref)} %)
          {money.blocked && <><br />{money.blocked} — сохраним как цену этапа без скидки</>}
        </p>
      )}
      {legacy && canGive && (
        <p className="step-price-note muted" role="note">
          В прайсе сейчас {somText(listPrice)} — <button type="button" className="link" onClick={() => onChange(typePrice({ ...value, ref: listPrice }, value.price))}>
            оформить разницу {somText(listPrice - (price ?? 0))} скидкой</button>?
        </p>
      )}
    </div>
  )
}

/**
 * Цена этапа в строке плана: без скидки — «4 500 сом»; со скидкой — «~~4 500~~ 4 050 сом (−10 %)» или «(−1 500)», если скидка
 * суммой. Без цены (или ассистенту — сервер цен не отдаёт) — ничего.
 */
export function StepPriceText({ step: s }: { step: Pick<Schemas['TreatmentStepView'], 'priceSom' | 'netSom' | 'discountPercent' | 'discountSom'> }) {
  if (s.priceSom == null) return null
  if (s.netSom == null || !s.discountSom) return <>{somText(s.priceSom)}</>
  return (
    <span className="step-price-text" aria-label={`Цена ${somText(s.priceSom)}, со скидкой ${somText(s.netSom)}`}>
      <span className="step-price-was"><s>{number(s.priceSom)}</s> <span className="step-price-off">−{s.discountPercent != null ? `${s.discountPercent} %` : number(s.discountSom)}</span></span>
      {' '}<b>{somText(s.netSom)}</b>
    </span>
  )
}


/** Цена в таблице листа: со скидкой (V257) — «~~4 500 сом~~ 4 050 сом (−10 %)». */
export function PriceCell({ step: s }: { step: Pick<Schemas['TreatmentStepView'], 'priceSom' | 'netSom' | 'discountSom' | 'discountPercent'> }) {
  if (s.priceSom == null) return null
  if (s.netSom == null || !s.discountSom) return <>{somText(s.priceSom)}</>
  return (
    <><s>{somText(s.priceSom)}</s><br /><b>{somText(s.netSom)}</b> <small>(−{s.discountPercent != null ? `${s.discountPercent} %` : somText(s.discountSom)})</small></>
  )
}

const NUMBER = new Intl.NumberFormat('ru-RU')

function number(n: number): string {
  return NUMBER.format(n)
}
