import type { ActionItem } from '../layout/ActionMenu'
import { ActionMenu } from '../layout/ActionMenu'
import type { ContactItem } from './contactItems'

/**
 * «📞 Связаться ▾» — все кнопки связи с пациентом одной кнопкой (2026-11-19, «экономить место»): группа
 * «Связаться» (позвонить, написать) и «Отправить пациенту» (напомнить о приёме, попросить оценку, напомнить о
 * долге). Компьютер — меню, телефон — нижний лист (ActionMenu). Пункт один — кнопка сразу делает его, без меню;
 * пунктов нет (ни телефона, ни бота) — кнопки нет.
 */
export function ContactMenu({ items, className = 'btn' }: { items: ContactItem[]; className?: string }) {
  if (!items.length) return null
  if (items.length === 1) {
    const i = items[0]!
    // Звонок — ссылкой tel: (в Telegram — своя страница звонка): так звонилка открывается надёжнее
    return i.href
      ? <a className={className} href={i.href} onClick={(e) => i.onSelect(e)} aria-label={i.ariaLabel}>{i.label}</a>
      : <button type="button" className={className} disabled={i.disabled} title={i.hint} onClick={i.onSelect}>{i.label}</button>
  }
  const menu: ActionItem[] = items.map((i) => ({
    label: i.label, icon: i.icon, hint: i.hint, disabled: i.disabled, onSelect: i.onSelect, href: i.href,
    group: i.group === 'contact' ? 'Связаться' : 'Отправить пациенту',
  }))
  return <ActionMenu label="Связаться" className={className} content={<><span aria-hidden="true">📞 </span>Связаться</>} items={menu} />
}
