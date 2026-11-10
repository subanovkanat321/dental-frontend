import { useState } from 'react'

/**
 * Кого не показывать колонкой в «Все врачи» — на этом устройстве (окно «Врачи в расписании»).
 * Храним скрытых, а не показанных: новый врач клиники в списке не значится — значит, показан.
 * В localStorage только id врачей: это не персональные данные. Одного врача (чипы, выбор врача,
 * «Неделя») скрытие не касается — только колонки «Все врачи».
 */
export const DOCTOR_HIDDEN_KEY = 'crm.schedule.doctorHidden'

/** Скрытые id или пустой список (нет записи, нет localStorage, мусор). */
export function readHiddenDoctors(): number[] {
  try {
    const raw = localStorage.getItem(DOCTOR_HIDDEN_KEY)
    if (!raw) return []
    const ids: unknown = JSON.parse(raw)
    return Array.isArray(ids) && ids.every((id) => Number.isInteger(id)) ? (ids as number[]) : []
  } catch {
    return []
  }
}

/** Сохранить; пустой список — забыть (все показаны). */
export function writeHiddenDoctors(ids: number[]): void {
  try {
    if (ids.length) localStorage.setItem(DOCTOR_HIDDEN_KEY, JSON.stringify(ids))
    else localStorage.removeItem(DOCTOR_HIDDEN_KEY)
  } catch {
    // приватный режим — выбор живёт до перезагрузки
  }
}

/**
 * Кто колонкой в «Все врачи»: все, кроме скрытых. Скрыты оказались все (врачей в клинике стало
 * меньше, а сохранённый выбор старый) — показываем всех: пустое расписание никому не нужно.
 */
export function visibleDoctors<T extends { id?: number }>(doctors: T[], hidden: readonly number[]): T[] {
  const left = doctors.filter((d) => !hidden.includes(d.id!))
  return left.length ? left : doctors
}

/** Скрытые как состояние: поменяли — расписание сразу перерисовывается. */
export function useHiddenDoctors(): [number[], (ids: number[]) => void] {
  const [hidden, setHidden] = useState(readHiddenDoctors)
  const change = (ids: number[]) => {
    writeHiddenDoctors(ids)
    setHidden(ids)
  }
  return [hidden, change]
}

/** «Айгерим Садыкова» → «Айгерим»: в подсказке «Выходной: …» мало места. */
export function firstName(name = ''): string {
  return name.trim().split(/\s+/)[0] ?? name
}
