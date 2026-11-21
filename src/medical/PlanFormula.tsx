import type { Dentition } from './dentition'
import { ToothFormula } from './ToothFormula'
import { ToothFigure, ToothLegendItem } from './ToothGlyph'
import type { Surface, ToothState } from './toothStates'

/** Зуб на рисунке плана: номер, состояние с карты и поверхности. */
export type PlanTooth = { number: number; state?: ToothState | null; surfaces?: readonly Surface[] | null }

/** Подписи: печатный лист — по-русски из карты зубов, план пациента — из его i18n (ru/ky). */
export type PlanFormulaTexts = {
  /** Состояние для легенды и скринридера: «Кариес», «нет зуба»… */
  state: (s: ToothState) => string
  /** Подпись блока для скринридера */
  title: string
  /** «в плане лечения» — легенда; plannedLabel — то же у зуба для скринридера (на листе короче: «в плане») */
  planned: string
  plannedLabel?: string
  jaws?: readonly [string, string]
  /** Подпись зуба для скринридера сверх номера и состояния: этапы плана */
  extra?: (n: number) => string | null
}

/**
 * Зубная формула плана лечения: обе челюсти рисунком из карты зубов (раскладка {@link ToothFormula}: как смотрит врач,
 * молочные — на местах преемников), состояние цветом, зуб с несделанным этапом — в пунктирной рамке, внизу легенда.
 * Один рисунок на печатном листе («🖨 План лечения», print/PlanChart) и у пациента (patient/PlanView: страница /plan и
 * Mini App) — размеры и цвета задаёт CSS места (.print-sheet .plan-chart и .plan-view .plan-chart).
 *
 * @param teeth зубы, которые рисовать со своим состоянием; остальные — здоровыми
 * @param chartTeeth что отмечено на карте — сменному прикусу решить, где ещё молочный; по умолчанию {@code teeth}
 * @param onSelect есть — зубы в рамке становятся кнопками (план пациента: нажал — подсветить этапы)
 */
export function PlanFormula({ dentition, teeth, chartTeeth = teeth, planned, texts, selected, onSelect, className = '' }: {
  dentition: Dentition
  teeth: readonly PlanTooth[]
  chartTeeth?: readonly PlanTooth[]
  planned: ReadonlySet<number>
  texts: PlanFormulaTexts
  selected?: number | null
  onSelect?: (n: number) => void
  className?: string
}) {
  const byNumber = new Map(teeth.map((t) => [t.number, t]))
  const used = [...new Set(teeth.map((t) => t.state).filter((s): s is ToothState => !!s && s !== 'HEALTHY'))]
  const charted = chartTeeth.map((t) => ({ number: t.number, state: t.state ?? undefined }))
  return (
    <section className={`plan-chart ${className}`.trim()} aria-label={texts.title}>
      <ToothFormula className="plan-chart-formula" dentition={dentition} teeth={charted} jawLabels={texts.jaws} render={(n) => {
        const t = byNumber.get(n)
        const state = t?.state ?? 'HEALTHY'
        const inPlan = planned.has(n)
        const label = [String(n), state !== 'HEALTHY' ? texts.state(state) : null, inPlan ? (texts.plannedLabel ?? texts.planned) : null, texts.extra?.(n) ?? null]
          .filter(Boolean).join(' · ')
        const cls = `tooth plan-chart-tooth${inPlan ? ' planned' : ''}${selected === n ? ' selected' : ''}`
        const figure = <ToothFigure number={n} state={t?.state ?? undefined} surfaces={t?.surfaces ?? undefined} />
        return inPlan && onSelect ? (
          <button key={n} type="button" className={cls} data-state={state} aria-label={label} aria-pressed={selected === n}
            onClick={() => onSelect(n)}>{figure}</button>
        ) : (
          <span key={n} className={cls} data-state={state} aria-label={label}>{figure}</span>
        )
      }} />
      <p className="plan-chart-legend">
        {used.map((s) => <ToothLegendItem key={s} state={s} label={texts.state(s)} />)}
        {planned.size > 0 && <span className="plan-chart-key"><span className="plan-chart-box" aria-hidden="true" /> {texts.planned}</span>}
      </p>
    </section>
  )
}
