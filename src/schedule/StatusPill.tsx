import type { Schemas } from '../api/client'
import { ActionMenu, type ActionItem } from '../layout/ActionMenu'
import { CARD_ORDER, CARD_STATUS, cardStatusOf, type CardStatus } from './status'
import type { Option } from './statusOptions'

type Appointment = Schemas['AppointmentView']

/**
 * Статус приёма одной «пилюлей» вверху карточки: «🟢 Пришёл ▾» — цвет по статусу, нажатие открывает все
 * статусы (✓ — текущий; компьютер — меню, телефон — нижний лист со свайпом вниз, как ActionMenu).
 * Без прав (приём коллеги) — та же пилюля без ▾, только посмотреть.
 */
export function StatusPill({ appointment: a, options, disabled }: {
  appointment: Appointment
  /** null — менять нельзя (только посмотреть) */
  options: Record<CardStatus, Option> | null
  disabled?: boolean
}) {
  const now = cardStatusOf(a)
  const s = CARD_STATUS[now]
  const content = <><span className="ico" aria-hidden="true">{s.icon}</span>{s.label}</>
  if (!options) return <span className={`chip status-pill s-${s.kind}`} aria-label={`Статус: ${s.label}`}>{content}</span>
  const items = CARD_ORDER.flatMap((key): ActionItem[] => {
    const st = CARD_STATUS[key]
    if (key === now) return [{ label: st.menu, icon: st.icon, checked: true, onSelect: () => {} }]
    const o = options[key]
    return o ? [{ ...o, label: st.menu, icon: st.icon, checked: false }] : []
  })
  return (
    <ActionMenu label="Статус приёма" buttonLabel={`Статус: ${s.label}`} className={`chip status-pill s-${s.kind}`}
      content={content} items={items} disabled={disabled} />
  )
}
