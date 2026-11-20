import type { MouseEvent } from 'react'

import type { ActionItem } from '../layout/ActionMenu'
import { contactPhone } from '../lib/guardian'
import { inTelegram, openLink } from '../lib/telegram'
import { formatPhone } from '../lib/time'

/** Пункт «Связаться ▾»: href — ссылка (звонок, SMS), onSelect получает её событие; иначе — кнопка. */
export type ContactItem = {
  label: string
  group: 'contact' | 'send'
  onSelect: (e?: MouseEvent) => void
  href?: string
  ariaLabel?: string
  icon?: string
  hint?: string
  disabled?: boolean
}

/**
 * «Позвонить» и «Написать в WhatsApp» (пустой чат) — без готового текста: опаздывает, не пришёл, после приёма.
 * Номер — представителя, если он есть (contactPhone). В Telegram tel: не открывает звонилку — своя страница
 * call.html, номер во фрагменте # (на сервер не уходит).
 */
export function talkItems(patient: Parameters<typeof contactPhone>[0], { whatsapp = true }: { whatsapp?: boolean } = {}): ContactItem[] {
  const phone = contactPhone(patient)
  if (!phone) return []
  const tel = `tel:+${phone}`
  return [
    {
      label: 'Позвонить', group: 'contact', icon: 'phone', href: tel, ariaLabel: `Позвонить: ${formatPhone(phone)}`, hint: formatPhone(phone),
      onSelect: (e) => { if (e) inTelegram(tel)(e) },
    },
    ...(whatsapp ? [{ label: 'Написать в WhatsApp', group: 'contact' as const, icon: 'whatsapp', onSelect: () => openLink(`https://wa.me/${phone}`) }] : []),
  ]
}

/** Пункты «Связаться ▾» как пункты меню (с подзаголовками групп) — для ContactMenu и меню быстрых действий на записи. */
export function contactActionItems(items: ContactItem[]): ActionItem[] {
  return items.map((i) => ({
    label: i.label, icon: i.icon, hint: i.hint, disabled: i.disabled, onSelect: i.onSelect, href: i.href,
    group: i.group === 'contact' ? 'Связаться' : 'Отправить пациенту',
  }))
}
