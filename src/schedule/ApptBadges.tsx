import type { Schemas } from '../api/client'
import { somText } from '../lib/time'
import { colleagueMarkText } from './chairTime'

type Appointment = Schemas['AppointmentView']

/**
 * Значки на карточке приёма — то, что регистратуре важно увидеть, не открывая карточку:
 * 🪑 записан в часы коллеги по креслу, ⭐ первый визит, 💬 есть комментарий, 🧾 долг по приёму (только тем, кто
 * видит деньги этого врача).
 * Подтверждение («Придёт 👍») уже в статусе — здесь не дублируем. Подсказка — при наведении, и та же
 * расшифровка — в легенде под расписанием.
 *
 * Подпись у значка — по ширине блока приёма (container query `.appt` в styles.css): в широком блоке
 * чип «⭐ Первый визит», в среднем — «⭐ Новый», в узком (неделя, телефон) — голый значок. Подпись
 * рисует CSS из data-атрибутов: текст в DOM и имя для скринридера (aria-label) не меняются.
 */
type Badge = { icon: string; text: string; short?: string; long: string }
type ChairTime = Schemas['SlotsViewChairTime']

function badgesOf(a: Appointment, money: boolean, chair: ChairTime | undefined): Badge[] {
  const list: Badge[] = []
  // Приём в рабочих часах коллеги по креслу (V187; colleagueTimeOf) — первым: это про само время приёма
  if (chair) {
    const name = chair.doctorName ?? 'коллеги'
    list.push({ icon: '🪑', text: colleagueMarkText(chair), short: firstName(name), long: `время ${name}` })
  }
  if (a.firstVisit && a.status !== 'CANCELLED') list.push({ icon: '⭐', text: 'Первый визит', short: 'Новый', long: 'Первый визит' })
  if (a.comment?.trim()) list.push({ icon: '💬', text: `Комментарий: ${a.comment.trim()}`, long: 'Комментарий' })
  if (money && (a.debtSom ?? 0) > 0) list.push({ icon: '🧾', text: `Долг ${somText(a.debtSom!)}`, long: `Долг ${somText(a.debtSom!)}` })
  return list
}

/** «Айгерим С.» → «Айгерим»: среднему блоку — коротко. */
function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name
}

/** @param chair часы коллеги по креслу, в которые попал приём (colleagueTimeOf), — значок 🪑 */
export function ApptBadges({ appointment, money, chair }: { appointment: Appointment; money: boolean; chair?: ChairTime }) {
  const list = badgesOf(appointment, money, chair)
  if (!list.length) return null
  return (
    <span className="appt-badges">
      {list.map((b) => (
        <span key={b.icon} className="appt-badge" title={b.text} role="img" aria-label={b.text} data-short={b.short} data-long={b.long}>{b.icon}</span>
      ))}
    </span>
  )
}

/** Легенда значков — одной строкой под расписанием; 🪑 — только в клинике с общими креслами. */
export function BadgesLegend({ chair = false }: { chair?: boolean }) {
  return <p className="badges-legend hint small">⭐ первый визит · 💬 комментарий · 🧾 долг{chair ? ' · 🪑 в часы коллеги по креслу' : ''}</p>
}
