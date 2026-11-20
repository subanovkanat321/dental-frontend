import type { Schemas } from '../api/client'

type Step = Schemas['PlanTemplatesStep']
type Service = Schemas['ServiceTypeView']
type Template = Schemas['PlanTemplatesView']
type PlanStep = Schemas['TreatmentStepView']

/**
 * Готовые шаблоны плана (шаг 4А, опыт Dentist Plus): «Имплант под ключ», «Санация», «Ортодонтия — брекеты». Кнопка
 * «Добавить готовые» в «Настройки → Шаблоны плана» и в окне «📄 Из шаблона», пока своих нет. Услугу прайса подбираем по
 * названию (у каждой клиники свой прайс): нашли — цена будет из прайса, нет — шаг без услуги, цену впишут в плане.
 * Названия процедур — как пишут врачи; пациентов здесь нет.
 */
type Starter = { title: string; steps: { title: string; stage: number; perTooth?: boolean; match?: RegExp }[] }

export const STARTERS: Starter[] = [
  {
    title: 'Имплант под ключ',
    steps: [
      { title: 'Консультация хирурга, КТ', stage: 1, match: /кт|томограф|консультац.*хирург/i },
      { title: 'Установка импланта', stage: 1, perTooth: true, match: /имплант(?!.*коронк)/i },
      { title: 'Формирователь десны', stage: 2, perTooth: true, match: /формировател/i },
      { title: 'Коронка на имплант', stage: 3, perTooth: true, match: /коронк.*имплант|имплант.*коронк/i },
    ],
  },
  {
    title: 'Санация',
    steps: [
      { title: 'Профессиональная гигиена', stage: 1, match: /гигиен|чистк/i },
      { title: 'Лечение кариеса', stage: 2, perTooth: true, match: /кариес/i },
      { title: 'Контрольный осмотр', stage: 3, match: /осмотр/i },
    ],
  },
  {
    title: 'Ортодонтия — брекеты',
    steps: [
      { title: 'Консультация ортодонта, слепки, снимки', stage: 1, match: /ортодонт/i },
      { title: 'Профессиональная гигиена', stage: 2, match: /гигиен|чистк/i },
      { title: 'Установка брекет-системы', stage: 3, match: /брекет/i },
      { title: 'Коррекция брекет-системы', stage: 4, match: /коррекц/i },
      { title: 'Снятие брекетов, ретейнер', stage: 5, match: /ретейнер|снятие брекет/i },
    ],
  },
]

/** Шаги готового шаблона под прайс клиники: первая работающая услуга, чьё название подходит. */
export function starterSteps(starter: Starter, services: Service[]): Step[] {
  const active = services.filter((s) => s.active !== false)
  return starter.steps.map((s) => ({
    title: s.title,
    stage: s.stage,
    perTooth: Boolean(s.perTooth),
    serviceTypeId: s.match ? active.find((x) => s.match!.test(x.name))?.id : undefined,
  }))
}

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

