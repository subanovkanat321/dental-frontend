import { useQuery, type QueryClient } from '@tanstack/react-query'

import { api, ApiError, unwrap, type Schemas } from '../api/client'

type Progress = Schemas['PlanStatesProgress']
type Step = Schemas['TreatmentStepView']
export type PlanStatus = NonNullable<Progress['status']>

/**
 * Статус плана лечения (V236, сервер — PlanStates): выводится из этапов и согласия, руками — только «Пациент
 * согласен» и «Отказался». Подписи — как у Dentist Plus, но по-нашему.
 */
export const PLAN_STATUS: Record<PlanStatus, { label: string; tone: string }> = {
  PROPOSED: { label: 'Предложен', tone: 'quiet' },
  AGREED: { label: 'Согласован', tone: 'ok' },
  IN_PROGRESS: { label: 'В работе', tone: 'here' },
  COMPLETED: { label: 'Завершён', tone: 'done' },
  REFUSED: { label: 'Отказался', tone: 'bad' },
}

/** Ключ кэша статуса — внутри ['plan', id]: кто сбрасывает план пациента целиком, сбросит и статус. */
export const planStatusKey = (patientId: number) => ['plan', patientId, 'status'] as const

/** Статус и прогресс плана; нет доступа к медкарте (403/404) — data нет, строки нет. */
export function usePlanStatus(patientId: number, enabled = true) {
  return useQuery<Progress, ApiError>({
    queryKey: planStatusKey(patientId),
    queryFn: () => unwrap(api.GET('/api/patients/{patientId}/plan/status', { params: { path: { patientId } } })),
    enabled,
    retry: false,
  })
}

/**
 * Этапы плана сохранили (ответ — весь план): положить в кэш ['plan', id] и пересчитать статус — «сделано» меняет
 * «Согласован» на «В работе», последний этап — на «Завершён», новый этап снимает отказ.
 */
export function planSaved(client: QueryClient, patientId: number, steps: Step[]) {
  client.setQueryData(['plan', patientId], steps)
  void client.invalidateQueries({ queryKey: planStatusKey(patientId) })
}

const number = new Intl.NumberFormat('ru-RU')

/**
 * «выполнено 3 из 7 · 12 000 из 40 000 сом»; сумм нет (ассистент или цены не вписаны) — без них.
 */
export function progressText(p: Pick<Progress, 'done' | 'total' | 'doneSom' | 'totalSom'>): string {
  const parts = [`выполнено ${p.done} из ${p.total}`]
  if (p.totalSom != null && p.totalSom > 0) parts.push(`${number.format(p.doneSom ?? 0)} из ${number.format(p.totalSom)} сом`)
  return parts.join(' · ')
}

/** Доля сделанного для полоски: по деньгам, если цены есть, иначе по этапам. */
export function progressShare(p: Pick<Progress, 'done' | 'total' | 'doneSom' | 'totalSom'>): number {
  if (p.totalSom != null && p.totalSom > 0) return Math.min(1, (p.doneSom ?? 0) / p.totalSom)
  return p.total ? p.done / p.total : 0
}

/**
 * Коротко для строки «План лечения» в карточке приёма: «0 из 12 этапов · 99 000 сом», начали — «3 из 12 этапов ·
 * 12 000 из 99 000 сом»; сумм нет (ассистент) — только этапы. «Из 1 этапа, из 21 этапа» — родительный падеж.
 */
export function progressShort(p: Pick<Progress, 'done' | 'total' | 'doneSom' | 'totalSom'>): string[] {
  const word = p.total % 10 === 1 && p.total % 100 !== 11 ? 'этапа' : 'этапов'
  const parts = [`${p.done} из ${p.total} ${word}`]
  if (p.totalSom != null && p.totalSom > 0) {
    parts.push(`${p.doneSom ? `${number.format(p.doneSom)} из ` : ''}${number.format(p.totalSom)} сом`)
  }
  return parts
}
