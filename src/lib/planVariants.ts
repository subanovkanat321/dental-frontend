import type { Schemas } from '../api/client'

type Step = Schemas['TreatmentStepView']
type Variant = Schemas['PlanVariantsVariantView']

/** Больше трёх вариантов плана сервер не даёт (PlanVariants.MAX, V254). */
export const MAX_VARIANTS = 3

/** Кэш вариантов плана пациента: этапы и итоги каждого варианта. */
export const variantsKey = (patientId: number) => ['plan-variants', patientId] as const

const VIA: Record<string, string> = { STAFF: 'отметил сотрудник', BOT: 'в боте', APP: 'в приложении', PAGE: 'по ссылке' }

/** «выбран пациентом · в боте» — у выбранного варианта; не выбирал — null. */
export function chosenText(v: Variant): string | null {
  return v.chosenAt ? `выбран пациентом${v.chosenVia && VIA[v.chosenVia] ? ` · ${VIA[v.chosenVia]}` : ''}` : null
}

/** Процедуры на весь рот — быстрые кнопки «＋ Без зуба» (чистка, консультация…): по названию услуги в прайсе. */
export const GENERAL = /чистк|гигиен|консульт|осмотр|отбел|рентген|снимок|панорам|ортопантом|томограф|(^|[^а-яё])кт([^а-яё]|$)|фтор|герметиз|air ?flow|эйр/i

/** «В конце» по умолчанию — то, что делают после лечения: чистка, отбеливание, контрольный осмотр. */
export const LAST = /чистк|гигиен|отбел|контрол/i

/** Последний этап несделанных + 1 (не больше 9): «В конце плана». Плана нет — этап 1. */
export function lastStage(steps: Step[]): number {
  const open = steps.filter((s) => !s.doneAt)
  return open.length === 0 ? 1 : Math.min(9, Math.max(...open.map((s) => s.stage)) + 1)
}
