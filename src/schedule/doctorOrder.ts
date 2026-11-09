import { useState } from 'react'

/**
 * Порядок врачей в расписании (колонки «Все врачи», сетка дня, чипы и выбор врача) — на этом
 * устройстве. В localStorage только id врачей по порядку: это не персональные данные.
 */
export const DOCTOR_ORDER_KEY = 'crm.schedule.doctorOrder'

/** Сохранённый порядок или null — порядка нет (или localStorage недоступен, или там мусор). */
export function readDoctorOrder(): number[] | null {
  try {
    const raw = localStorage.getItem(DOCTOR_ORDER_KEY)
    if (!raw) return null
    const ids: unknown = JSON.parse(raw)
    return Array.isArray(ids) && ids.every((id) => Number.isInteger(id)) ? (ids as number[]) : null
  } catch {
    return null
  }
}

/** Сохранить порядок; null — забыть («Как было»). */
export function writeDoctorOrder(ids: number[] | null): void {
  try {
    if (ids) localStorage.setItem(DOCTOR_ORDER_KEY, JSON.stringify(ids))
    else localStorage.removeItem(DOCTOR_ORDER_KEY)
  } catch {
    // приватный режим — порядок живёт до перезагрузки
  }
}

/**
 * Врачи в нужном порядке:
 * - есть сохранённый порядок — по нему; врача, которого в нём нет (новый), — в конец, в прежнем
 *   порядке; id удалённого врача из сохранённого просто ни на кого не указывает;
 * - порядка нет, а сотрудник сам врач — его колонка первой, остальные как были;
 * - иначе — как пришли с сервера.
 */
export function orderDoctors<T extends { id?: number }>(doctors: T[], saved: number[] | null, myDoctorId?: number | null): T[] {
  if (saved) {
    const place = new Map(saved.map((id, i) => [id, i]))
    const rank = (d: T) => place.get(d.id!) ?? Number.MAX_SAFE_INTEGER
    // sort устойчивый: новые врачи (одинаковый rank) остаются в прежнем порядке между собой
    return [...doctors].sort((a, b) => rank(a) - rank(b))
  }
  const mine = doctors.find((d) => d.id === myDoctorId)
  return mine ? [mine, ...doctors.filter((d) => d !== mine)] : doctors
}

/** Сохранённый порядок как состояние: поменяли — расписание сразу перерисовывается. */
export function useDoctorOrder(): [number[] | null, (ids: number[] | null) => void] {
  const [order, setOrder] = useState(readDoctorOrder)
  const change = (ids: number[] | null) => {
    writeDoctorOrder(ids)
    setOrder(ids)
  }
  return [order, change]
}
