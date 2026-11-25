import type { Schemas } from '../api/client'
import { badgesOf, MAX_BADGES } from './badges'
import { useChairs } from '../team/chairs'
import { useDebtsByPatient } from '../lib/debt'
import { useMedAlert } from '../lib/medAlerts'

type Appointment = Schemas['AppointmentView']
type ChairTime = Schemas['SlotsViewChairTime']

/**
 * @param chair часы коллеги по креслу, в которые попал приём (colleagueTimeOf), — значок 🪑
 * @param max сколько значков показать (самые важные); сетка на узкой записи — 1 ({@link narrowAppt})
 */
export function ApptBadges({ appointment, money, chair, max = MAX_BADGES }: { appointment: Appointment; money: boolean; chair?: ChairTime; max?: number }) {
  // Кэш кресел общий с расписанием — без лишних запросов
  const chairs = useChairs(Boolean(appointment.chairManual))
  const otherChair = appointment.chairManual && appointment.status !== 'CANCELLED'
    ? chairs.data?.find((c) => c.id === appointment.chairId)?.name ?? null : null
  // Долги пациентов — один запрос на экран (кэш общий); у кого нет прав на «Должников», запроса нет
  const debts = useDebtsByPatient()
  // ❗ — один запрос на экран на всех пациентов (lib/medAlerts склеивает), кэш общий с карточкой приёма
  const alert = useMedAlert(appointment.patient?.id)
  const all = badgesOf(appointment, money, chair, otherChair, appointment.patient?.id != null ? debts.get(appointment.patient.id) : 0, alert)
  if (!all.length) return null
  const list = all.slice(0, Math.max(1, max))
  return (
    <span className="appt-badges">
      {list.map((b) => (
        <span key={`${b.icon}${b.long}`} className={b.tone ? `appt-badge pay-${b.tone}` : 'appt-badge'} title={b.text} role="img" aria-label={b.text} data-short={b.short} data-long={b.long}>{b.icon}</span>
      ))}
    </span>
  )
}

/**
 * Легенда значков — одной строкой под расписанием; 🪑 — только в клинике с общими креслами. Без денег
 * (ассистент) — без значков оплаты: их у него на приёмах нет, а легенда про долги лишь путала.
 */
export function BadgesLegend({ chair = false, money = true }: { chair?: boolean, money?: boolean }) {
  return <p className="badges-legend hint small">❗ важно для врача{money ? ' · 🧾 долг · ½ частично · ✓ оплачено' : ''} · ⭐ ВИП · 🆕 первый визит · 💬 комментарий{chair ? ' · 🪑 в часы коллеги по креслу' : ''}</p>
}
