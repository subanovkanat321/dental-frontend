import { useQuery } from '@tanstack/react-query'
import { useCallback, useMemo, useSyncExternalStore } from 'react'

import { api, unwrap, type Schemas } from '../api/client'
import type { ServiceGroup } from '../clinic/services'
import { colorOf } from '../lib/avatars'

type Appointment = Schemas['AppointmentView']

/**
 * «Чем красить запись» в расписании (шаг 6А, как «Настройки календаря» у Dentist Plus): по статусу (как всегда),
 * по врачу или по разделу услуги. Выбор — на этом устройстве (localStorage, только слово — не личные данные):
 * регистратуре удобнее статус, руководителю на общем экране — врач; клинике целиком навязывать одно не нужно.
 * Меняется в «Настройки → Оформление» и строкой под сеткой «Дня» — обе сразу видят новый выбор (useSyncExternalStore).
 */
export type Paint = 'status' | 'doctor' | 'service'

export const PAINTS: readonly (readonly [Paint, string])[] = [['status', 'Статус'], ['doctor', 'Врач'], ['service', 'Услуга']]

export const PAINT_KEY = 'crm.schedule.paint'

const listeners = new Set<() => void>()

/** Выбор, когда хранилища нет (приватный режим): до перезагрузки */
let memory: Paint = 'status'

function snapshot(): Paint {
  try {
    const saved = localStorage.getItem(PAINT_KEY)
    return saved === 'doctor' || saved === 'service' ? saved : 'status'
  } catch {
    return memory
  }
}

export function setPaint(next: Paint): void {
  memory = next
  try {
    if (next === 'status') localStorage.removeItem(PAINT_KEY)
    else localStorage.setItem(PAINT_KEY, next)
  } catch {
    // приватный режим — остаётся memory
  }
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  // Другая вкладка поменяла выбор — тоже перекрасить
  const onStorage = (e: StorageEvent) => { if (e.key === PAINT_KEY || e.key == null) listener() }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function usePaint(): [Paint, (next: Paint) => void] {
  return [useSyncExternalStore(subscribe, snapshot, () => 'status' as Paint), setPaint]
}

/**
 * Непрочная запись — штриховка поверх цвета и тонкая рамка: заявка (ещё не подтвердили в клинике) и «Записан»,
 * но пациент не подтвердил (нет ответа, просит перенести, напоминание не ушло). Пришёл / в кресле / подтвердил —
 * прочная. Прошедшая неотмеченная — уже не «непрочная запись», а «отметьте явку» (своё слово статуса).
 */
export function isShaky(a: Appointment, now = new Date()): boolean {
  if (a.status === 'REQUESTED') return true
  if (a.status !== 'SCHEDULED' || a.arrivedAt || a.inChairAt || a.reply === 'CONFIRMED') return false
  return !(a.endAt && new Date(a.endAt) < now)
}

/**
 * Цвет раздела услуги (V169: у каждой услуги раздел) — для «красить по услуге». Те же различимые оттенки, что у
 * врачей (lib/avatars), «Другое» — серым. Раздела нет (услуга не выбрана или её удалили) — без цвета.
 */
export const GROUP_COLORS: Record<ServiceGroup, string> = {
  EXAM: '#3A8DB8',
  HYGIENE: '#0E8A80',
  THERAPY: '#5B7FD6',
  SURGERY: '#C2506B',
  PROSTHETICS: '#C2793B',
  ORTHODONTICS: '#8E5BB5',
  IMPLANTS: '#6E7C91',
  AESTHETICS: '#857A2C',
  KIDS: '#2F8F5B',
  XRAY: '#9E5B3D',
  OTHER: '#75898E',
}

/** Название услуги → её раздел: в записи сервер присылает только название (serviceName). */
export function groupByName(services: readonly Schemas['ServiceTypeView'][] | undefined): Map<string, ServiceGroup> {
  const map = new Map<string, ServiceGroup>()
  for (const s of services ?? []) if (s.name) map.set(s.name.trim().toLowerCase(), s.group ?? 'OTHER')
  return map
}

export function serviceColor(groups: Map<string, ServiceGroup>, name: string | undefined): string | undefined {
  const g = name ? groups.get(name.trim().toLowerCase()) : undefined
  return g ? GROUP_COLORS[g] : undefined
}

/**
 * Цвет заливки записи по выбору «чем красить»: статус — undefined (цвет даёт класс s-…), врач — его цвет
 * (lib/avatars, по списку клиники `colorDoctors`), услуга — цвет раздела (прайс клиники грузится, только когда выбрано
 * «Услуга»; ключ тот же, что у «Услуг», — кэш общий). Функция стабильна, пока не поменялись выбор и данные: блоки
 * сетки (memo) не перерисовываются зря.
 */
export function usePaintOf(colorDoctors: readonly { id?: number }[]): { paint: Paint; paintOf: (a: Appointment) => string | undefined } {
  const [paint] = usePaint()
  const services = useQuery({
    queryKey: ['service-types'],
    queryFn: () => unwrap(api.GET('/api/service-types')),
    enabled: paint === 'service',
    staleTime: 5 * 60_000,
  })
  const groups = useMemo(() => groupByName(services.data), [services.data])
  const ids = colorDoctors.map((d) => d.id).join(',')
  // eslint-disable-next-line react-hooks/exhaustive-deps -- список врачей сравниваем по id (новый массив на каждый рендер)
  const doctors = useMemo(() => colorDoctors, [ids])
  const paintOf = useCallback((a: Appointment) => (paint === 'doctor' ? colorOf(doctors, a.doctorId)
    : paint === 'service' ? serviceColor(groups, a.serviceName) ?? GROUP_COLORS.OTHER : undefined), [paint, doctors, groups])
  return { paint, paintOf }
}
