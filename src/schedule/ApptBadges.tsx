import type { Schemas } from '../api/client'
import { somText } from '../lib/time'

type Appointment = Schemas['AppointmentView']

/**
 * Значки на карточке приёма — то, что регистратуре важно увидеть, не открывая карточку:
 * ⭐ первый визит, 💬 есть комментарий, 🧾 долг по приёму (только тем, кто видит деньги этого врача).
 * Подтверждение («Придёт 👍») уже в статусе — здесь не дублируем. Подсказка — при наведении, и та же
 * расшифровка — в легенде под расписанием.
 *
 * Подпись у значка — по ширине блока приёма (container query `.appt` в styles.css): в широком блоке
 * чип «⭐ Первый визит», в среднем — «⭐ Новый», в узком (неделя, телефон) — голый значок. Подпись
 * рисует CSS из data-атрибутов: текст в DOM и имя для скринридера (aria-label) не меняются.
 */
type Badge = { icon: string; text: string; short?: string; long: string }

function badgesOf(a: Appointment, money: boolean): Badge[] {
  const list: Badge[] = []
  if (a.firstVisit && a.status !== 'CANCELLED') list.push({ icon: '⭐', text: 'Первый визит', short: 'Новый', long: 'Первый визит' })
  if (a.comment?.trim()) list.push({ icon: '💬', text: `Комментарий: ${a.comment.trim()}`, long: 'Комментарий' })
  if (money && (a.debtSom ?? 0) > 0) list.push({ icon: '🧾', text: `Долг ${somText(a.debtSom!)}`, long: `Долг ${somText(a.debtSom!)}` })
  return list
}

export function ApptBadges({ appointment, money }: { appointment: Appointment; money: boolean }) {
  const list = badgesOf(appointment, money)
  if (!list.length) return null
  return (
    <span className="appt-badges">
      {list.map((b) => (
        <span key={b.icon} className="appt-badge" title={b.text} role="img" aria-label={b.text} data-short={b.short} data-long={b.long}>{b.icon}</span>
      ))}
    </span>
  )
}

/** Легенда значков — одной строкой под расписанием. */
export function BadgesLegend() {
  return <p className="badges-legend hint small">⭐ первый визит · 💬 комментарий · 🧾 долг</p>
}
