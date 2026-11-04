import type { Schemas } from '../api/client'
import { somText } from '../lib/time'

type Appointment = Schemas['AppointmentView']

/**
 * Значки на карточке приёма — то, что регистратуре важно увидеть, не открывая карточку:
 * ⭐ первый визит, 💬 есть комментарий, 🧾 долг по приёму (только тем, кто видит деньги этого врача).
 * Подтверждение («Придёт 👍») уже в статусе — здесь не дублируем. Подсказка — при наведении, и та же
 * расшифровка — в легенде под расписанием.
 */
function badgesOf(a: Appointment, money: boolean): [string, string][] {
  const list: [string, string][] = []
  if (a.firstVisit && a.status !== 'CANCELLED') list.push(['⭐', 'Первый визит'])
  if (a.comment?.trim()) list.push(['💬', `Комментарий: ${a.comment.trim()}`])
  if (money && (a.debtSom ?? 0) > 0) list.push(['🧾', `Долг ${somText(a.debtSom!)}`])
  return list
}

export function ApptBadges({ appointment, money }: { appointment: Appointment; money: boolean }) {
  const list = badgesOf(appointment, money)
  if (!list.length) return null
  return (
    <span className="appt-badges">
      {list.map(([icon, text]) => <span key={icon} title={text} role="img" aria-label={text}>{icon}</span>)}
    </span>
  )
}

/** Легенда значков — одной строкой под расписанием. */
export function BadgesLegend() {
  return <p className="badges-legend hint small">⭐ первый визит · 💬 комментарий · 🧾 долг</p>
}
