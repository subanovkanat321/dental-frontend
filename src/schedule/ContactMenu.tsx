import type { ReactNode } from 'react'

import { ActionMenu } from '../layout/ActionMenu'
import { contactActionItems, type ContactItem } from './contactItems'

/**
 * «📞 Связаться ▾» — все кнопки связи с пациентом одной кнопкой (2026-11-19, «экономить место»): группа
 * «Связаться» (позвонить, написать) и «Отправить пациенту» (напомнить о приёме, попросить оценку, напомнить о
 * долге). Компьютер — меню, телефон — нижний лист (ActionMenu). Пункт один — кнопка сразу делает его, без меню;
 * пунктов нет (ни телефона, ни бота) — кнопки нет. `content` — своё содержимое кнопки: в карточке приёма это сам номер
 * пациента ссылкой «+996 … ▾» рядом с именем (2026-11-19: отдельная строка «📞 Связаться» под статусом была лишней).
 */
export function ContactMenu({ items, className = 'btn', content, label = 'Связаться' }: {
  items: ContactItem[]
  className?: string
  content?: ReactNode
  /** Имя кнопки со своим содержимым (для скринридера): «Связаться», у номера в шапке — «Связаться: +996 …» */
  label?: string
}) {
  if (!items.length) return null
  if (items.length === 1) {
    const i = items[0]!
    // Звонок — ссылкой tel: (в Telegram — своя страница звонка): так звонилка открывается надёжнее
    return i.href
      ? <a className={className} href={i.href} onClick={(e) => i.onSelect(e)} aria-label={i.ariaLabel ?? (content ? i.label : undefined)}>{content ?? i.label}</a>
      : <button type="button" className={className} disabled={i.disabled} title={i.hint} aria-label={content ? i.label : undefined} onClick={i.onSelect}>{content ?? i.label}</button>
  }
  return <ActionMenu label="Связаться" buttonLabel={content ? label : undefined} className={className} content={content ?? <><span aria-hidden="true">📞 </span>Связаться</>} items={contactActionItems(items)} />
}

