import type { Schemas } from '../api/client'
import { biggerDraft, draftSomAt, fitsPolicy, sameDraft, type GiftOffer } from '../patients/birthdayGift'
import { somText } from '../lib/time'
import type { DiscountDraft } from './discountDraft'

type Policy = Schemas['DiscountPoliciesPolicy']

/**
 * Строка над скидкой: «🎂 Подарок на день рождения: скидка 10 % · Применить» (стоит в форме — «· Убрать»). Есть и скидка по
 * метке — пишем, что скидки не складываются и какая больше. Подставить нечего или нельзя — только подсказка.
 */
export function BirthdayGiftNote({ offer, tag, tagName, price, policy, discount, onChange }: {
  offer: GiftOffer
  /** Скидка по метке (если есть) — для сравнения */
  tag: DiscountDraft | null
  tagName?: string
  price: number | null
  policy?: Policy
  discount: DiscountDraft | null
  onChange: (d: DiscountDraft | null) => void
}) {
  const som = offer.draft ? draftSomAt(price, offer.draft) : 0
  const what = `🎂 Подарок на день рождения: ${offer.what}${offer.draft?.kind === 'som' && som ? ` (${somText(som)})` : ''}`
  if (!offer.draft) return <p className="pay-tag-note muted" role="note">{what}{offer.code ? ` · код ${offer.code}` : ''}: {offer.why}</p>
  if (!fitsPolicy(offer.draft, price, policy)) {
    const why = !policy?.canGive ? 'скидку даёт руководитель' : `больше вашего предела (${policy.myMaxPercent} %) — решает руководитель`
    return <p className="pay-tag-note muted" role="note">{what}: {why}</p>
  }
  const on = sameDraft(discount, offer.draft)
  const tagFits = tag != null && fitsPolicy(tag, price, policy)
  const bigger = tagFits ? biggerDraft(offer.draft, tag, price) : null
  return (
    <>
      <p className={on ? 'pay-tag-note' : 'pay-tag-note muted'} role="note">
        {what} · {on
          ? <button type="button" className="link" onClick={() => onChange(null)}>Убрать</button>
          : <button type="button" className="link" onClick={() => onChange(offer.draft)}>Применить</button>}
      </p>
      {bigger && (
        <p className="hint small" role="note">
          Скидки не складываются: подарок — {somText(som)}, по метке{tagName ? ` «${tagName}»` : ''} — {somText(draftSomAt(price, tag))}.
          {bigger === 'gift' ? ' Подставляем бо́льшую — подарок.' : ' Подставляем бо́льшую — по метке.'}
        </p>
      )}
    </>
  )
}
