import { useState } from 'react'

import type { Schemas } from '../api/client'
import { canTag, tagDiscountHint, tagsOf, usePatientTags, useToggleTag, VIP } from './tags'

type Me = Schemas['BookingViewsMe']

/**
 * «Метки:» в «Новой записи» (2026-11-24, владелец: «выбрать это при записи, чтобы сразу было видно, кто это») — метки
 * клиники чипами-переключателями, выбранные залиты. Руководитель и регистратура: у выбранного пациента нажатие сразу
 * ставит или снимает метку (тот же PUT, что строка меток в карточке пациента); у нового пациента — только отмечает,
 * поставит форма, когда заведёт пациента при «Записать». Остальным — метки пациента без кнопок (нет — строки нет).
 * Ниже — подсказка о скидке по метке («Друг: скидка 10 % при оплате»): саму скидку подставит форма оплаты.
 *
 * patientId — выбранный пациент (метки сохраняются сразу); без него — новый пациент: selected / onChange формы.
 */
export function BookingTags({ me, patientId, tagIds, onChange }: {
  me: Me
  patientId?: number
  /** Метки пациента (из карточки) или выбранные для нового */
  tagIds: number[] | undefined
  /** Новый пациент: отметить или снять метку в форме */
  onChange?: (ids: number[]) => void
}) {
  const editable = canTag(me)
  const has = (tagIds?.length ?? 0) > 0
  const tags = usePatientTags(editable || has)
  const toggle = useToggleTag(patientId ?? 0)
  // Ответ PUT — свежие метки пациента: показываем сразу, не дожидаясь перечитанной карточки
  const [saved, setSaved] = useState<{ patientId: number; ids: number[] } | null>(null)
  const ids = patientId != null && saved?.patientId === patientId ? saved.ids : tagIds ?? []
  const list = tags.data ?? []
  const hint = tagDiscountHint(ids, list)

  if (!editable) {
    const shown = tagsOf({ tagIds: ids }, list)
    if (!shown.length) return null
    return (
      <div className="booking-tags" aria-label="Метки пациента">
        <span className="booking-tags-title">Метки:</span>
        {shown.map((t) => <span key={t.id} className="tag-chip"><span className={`tag-dot tag-${t.color ?? 'gray'}`} aria-hidden="true" />{t.name}</span>)}
        {hint && <p className="hint small booking-tags-hint">🏷 {hint}</p>}
      </div>
    )
  }
  if (!list.length) return null
  const on = new Set(ids)
  const flip = (tagId: number) => {
    const next = !on.has(tagId)
    if (patientId == null) {
      onChange?.(next ? [...ids, tagId] : ids.filter((id) => id !== tagId))
      return
    }
    toggle.mutate({ tagId, on: next }, { onSuccess: (p) => setSaved({ patientId, ids: p.tagIds ?? [] }) })
  }
  return (
    <div className="booking-tags" role="group" aria-label="Метки пациента">
      <span className="booking-tags-title">Метки:</span>
      {list.map((t) => (
        <button key={t.id} type="button" className="chip tag-toggle" aria-pressed={on.has(t.id)} disabled={toggle.isPending}
          title={t.discountPercent ? `Скидка по метке — ${t.discountPercent} %` : undefined} onClick={() => flip(t.id)}>
          <span className={`tag-dot tag-${t.color ?? 'gray'}`} aria-hidden="true" />{t.name}{t.code === VIP ? ' ⭐' : ''}
        </button>
      ))}
      {hint && <p className="hint small booking-tags-hint">🏷 {hint}</p>}
      {toggle.error && <p className="error booking-tags-hint" role="alert">{toggle.error.message}</p>}
    </div>
  )
}
