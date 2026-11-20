import type { ButtonHTMLAttributes } from 'react'

import { Icon } from './Icon'

/**
 * «Изменить» у строки с данными (`.line-edit`: услуга, комментарий, промокод, кресло, оплата…) — карандаш вместо слова
 * «изменить» (2026-11-20): строка короче, кнопка одна на вид во всём приложении. Имя для скринридера и подсказка мыши —
 * что именно меняем: `label="Изменить услугу"`. На телефоне — 44×44 под палец (crm.css → .edit-btn).
 */
export function EditButton({ label, className, ...rest }: { label: string } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'type'>) {
  return (
    <button type="button" className={className ? `edit-btn ${className}` : 'edit-btn'} aria-label={label} title={label} {...rest}>
      <Icon name="edit" />
    </button>
  )
}
