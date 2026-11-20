import type { Schemas } from '../api/client'

type Template = Schemas['PlanTemplatesView']
type PlanStep = Schemas['TreatmentStepView']

/** Сколько этапов занимает шаблон: «Имплант под ключ» — 3 (этапы 1–3). */
export function templateStages(t: Template): number {
  return Math.max(1, ...t.steps.map((s) => s.stage))
}

/**
 * С какого этапа начать по умолчанию: план пустой — с 1-го; есть несделанное — следующим после последнего этапа плана
 * (если шаблон туда помещается: в плане до 9 этапов), иначе — с 1-го.
 */
export function defaultStart(steps: PlanStep[], t: Template): number {
  const todo = steps.filter((s) => !s.doneAt)
  if (todo.length === 0) return 1
  const next = Math.max(...todo.map((s) => s.stage)) + 1
  return next - 1 + templateStages(t) <= 9 ? next : 1
}

