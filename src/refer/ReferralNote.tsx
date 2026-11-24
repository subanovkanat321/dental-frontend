import { draftSomAt, fitsPolicy, sameDraft } from '../patients/birthdayGift'
import { somText } from '../lib/time'
import type { Schemas } from '../api/client'
import type { DiscountDraft } from '../schedule/discountDraft'
import { biggestCandidate, type Candidate, type ReferralHint } from './referral'

type Policy = Schemas['DiscountPoliciesPolicy']

/**
 * Строка над скидкой в оплате: «🎁 Пришёл по приглашению — скидка 10 % · Применить» или «🎁 Бонус за друга (Бакыт) — скидка
 * 10 % · Применить» (стоит в форме — «· Убрать»). Подставить нечего или нельзя (политика скидок) — только подсказка.
 */
export function ReferralNote({ hint, price, policy, discount, onChange }: {
  hint: ReferralHint
  price: number | null
  policy?: Policy
  discount: DiscountDraft | null
  onChange: (d: DiscountDraft | null) => void
}) {
  const som = hint.draft ? draftSomAt(price, hint.draft) : 0
  const what = `${hint.what}${hint.draft?.kind === 'som' && som ? ` (${somText(som)})` : ''}`
  if (!hint.draft) return <p className="pay-tag-note muted" role="note">{what}: {hint.why}</p>
  if (!fitsPolicy(hint.draft, price, policy)) {
    const why = !policy?.canGive ? 'скидку даёт руководитель' : `больше вашего предела (${policy.myMaxPercent} %) — решает руководитель`
    return <p className="pay-tag-note muted" role="note">{what}: {why}</p>
  }
  const on = sameDraft(discount, hint.draft)
  return (
    <p className={on ? 'pay-tag-note' : 'pay-tag-note muted'} role="note">
      {what}{hint.usedHere && !on ? ' · уже дали в этой оплате' : ''} · {on
        ? <button type="button" className="link" onClick={() => onChange(null)}>Убрать</button>
        : <button type="button" className="link" onClick={() => onChange(hint.draft)}>Применить</button>}
    </p>
  )
}

/**
 * «Скидки не складываются: подарок — 600 сом, по метке «Друг» — 600 сом, по приглашению — 600 сом. Подставляем бо́льшую — …»
 * Показываем, когда подходящих подсказок больше одной.
 */
export function NoStackNote({ candidates, price, policy }: { candidates: Candidate[]; price: number | null; policy?: Policy }) {
  const fitting = candidates.filter((c) => c.draft && fitsPolicy(c.draft, price, policy))
  if (fitting.length < 2) return null
  const best = biggestCandidate(fitting, price, policy)
  return (
    <p className="hint small" role="note">
      Скидки не складываются: {fitting.map((c) => `${c.label} — ${somText(draftSomAt(price, c.draft))}`).join(', ')}.
      {best ? ` Подставляем бо́льшую — ${best.label}.` : ''}
    </p>
  )
}
