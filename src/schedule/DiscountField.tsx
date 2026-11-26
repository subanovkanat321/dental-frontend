import type { Schemas } from '../api/client'
import { DISCOUNT_REASONS } from '../lib/discount'
import { somText } from '../lib/time'
import { draftSom, type DiscountDraft } from './discountDraft'

type Policy = Schemas['DiscountPoliciesPolicy']

/** Частые скидки в процентах — кнопками */
const QUICK = [5, 10, 15, 20]

/** 3 000 из 18 000 → «16,7»: сколько процентов скидка в сомах (подсказка, считает и проверяет сервер) */
function percentOf(som: number, price: number): string {
  return (Math.round((som / price) * 1000) / 10).toString().replace('.', ',')
}

/**
 * «＋ Скидка» под стоимостью: % или сом, размер, причина кнопками, комментарий. Ниже — «Скидка 10 % — 600 сом ·
 * К оплате 5 400 сом». Кому скидку давать нельзя («Настройки → Пациенты и скидки → Скидки»), кнопки нет вовсе.
 */
export function DiscountField({ price, value, onChange, policy, autoFocus = true }: {
  price: number | null
  value: DiscountDraft | null
  onChange: (d: DiscountDraft | null) => void
  policy?: Policy
  /** Курсор в поле размера, когда блок открылся («＋ Скидка»); подставленная сама (по метке) — без фокуса */
  autoFocus?: boolean
}) {
  if (!policy?.canGive) return null
  if (!value) {
    return (
      <button type="button" className="link pay-discount-add" onClick={() => onChange({ kind: 'percent', value: '', reason: '', comment: '' })}>
        ＋ Скидка
      </button>
    )
  }
  const som = draftSom(price, value)
  const max = policy.myMaxPercent ?? 100
  return (
    <div className="pay-discount" role="group" aria-label="Скидка">
      <div className="pay-discount-row">
        <span className="pay-step-title">Скидка</span>
        <div className="segments" role="group" aria-label="Скидка в">
          <button type="button" aria-pressed={value.kind === 'percent'} onClick={() => onChange({ ...value, kind: 'percent' })}>%</button>
          <button type="button" aria-pressed={value.kind === 'som'} onClick={() => onChange({ ...value, kind: 'som' })}>сом</button>
        </div>
        {/* Без max: браузер молча не отправил бы форму — предел объясняет подсказка и проверка под формой */}
        <input type="number" min={1} inputMode="numeric"
          className="pay-discount-value" aria-label={value.kind === 'percent' ? 'Скидка, %' : 'Скидка, сом'}
          placeholder={value.kind === 'percent' ? '%' : 'сом'} autoFocus={autoFocus}
          value={value.value} onChange={(e) => onChange({ ...value, value: e.target.value })} />
        <button type="button" className="link" onClick={() => onChange(null)}>Убрать</button>
      </div>
      {/* Проценты — одним касанием (2026-11-23, владелец: «10 % — и программа сама считает»); свой — в поле выше */}
      <div className="pay-discount-quick" role="group" aria-label="Скидка в процентах">
        {QUICK.filter((p) => p <= max).map((p) => (
          <button key={p} type="button" className="chip" aria-pressed={value.kind === 'percent' && value.value === String(p)}
            onClick={() => onChange({ ...value, kind: 'percent', value: String(p) })}>{p} %</button>
        ))}
      </div>
      <div className="segments wrap pay-discount-reasons" role="group" aria-label="Причина скидки">
        {DISCOUNT_REASONS.map(([code, title]) => (
          <button key={code} type="button" aria-pressed={value.reason === code} onClick={() => onChange({ ...value, reason: code })}>{title}</button>
        ))}
      </div>
      {value.reason && (
        <input value={value.comment} maxLength={200} autoComplete="off" aria-label="Комментарий к скидке"
          placeholder={value.reason === 'OTHER' ? 'За что скидка' : 'Комментарий (можно не писать)'}
          onChange={(e) => onChange({ ...value, comment: e.target.value })} />
      )}
      {max < 100 && <p className="hint small">Ваш предел — до {max} % от цены</p>}
      {price != null && som > 0 && (
        <p className="pay-discount-sum" aria-label="Итог со скидкой">
          {value.kind === 'percent' ? `Скидка ${value.value} % — ${somText(som)}`
            : `Скидка ${somText(som)}${price > 0 ? ` (${percentOf(som, price)} %)` : ''}`}
          {' · '}К оплате <b className="num">{somText(Math.max(price - som, 0))}</b>
        </p>
      )}
    </div>
  )
}
