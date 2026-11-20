import type { Schemas } from '../api/client'
import { DISCOUNT_REASONS } from '../lib/discount'
import { somText } from '../lib/time'
import { draftSom, type DiscountDraft } from './discountDraft'

type Policy = Schemas['DiscountPoliciesPolicy']

/**
 * «＋ Скидка» под стоимостью: % или сом, размер, причина кнопками, комментарий. Ниже — «Скидка 10 % — 600 сом ·
 * К оплате 5 400 сом». Кому скидку давать нельзя («Настройки → Скидки»), кнопки нет вовсе.
 */
export function DiscountField({ price, value, onChange, policy }: {
  price: number | null
  value: DiscountDraft | null
  onChange: (d: DiscountDraft | null) => void
  policy?: Policy
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
          placeholder={value.kind === 'percent' ? '%' : 'сом'} autoFocus
          value={value.value} onChange={(e) => onChange({ ...value, value: e.target.value })} />
        <button type="button" className="link" onClick={() => onChange(null)}>Убрать</button>
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
          {value.kind === 'percent' ? `Скидка ${value.value} % — ${somText(som)}` : `Скидка ${somText(som)}`}
          {' · '}К оплате <b className="num">{somText(Math.max(price - som, 0))}</b>
        </p>
      )}
    </div>
  )
}
