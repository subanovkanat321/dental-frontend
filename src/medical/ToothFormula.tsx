import type { ReactNode } from 'react'

import { toothAt, type Dentition } from './dentition'

/**
 * Зубы по FDI так, как врач смотрит на пациента: сверху верхняя челюсть (правая сторона
 * пациента — 18…11, левая — 21…28), снизу нижняя (48…41 и 31…38). На большом экране — по 16 в ряд.
 * Молочные (55…51, 61…65, 85…81, 71…75) встают на места постоянных-преемников: 51 — на место 11 и т. д.
 */
const UPPER = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28]
const LOWER = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38]

type Charted = { number?: number; state?: string }

/**
 * Зубная формула: две челюсти по четвертям. Как выглядит и что делает зуб — решает {@code render}:
 * карта зубов в медкарте и «Зубы этого приёма» в карточке приёма рисуют одну и ту же раскладку.
 *
 * @param dentition прикус (по умолчанию постоянные); у молочного — 5 зубов в четверти
 * @param teeth что отмечено на карте — сменному прикусу, чтобы решить, где ещё молочный ({@link toothAt})
 */
export function ToothFormula({ render, className, dentition = 'PERMANENT', teeth }: {
  render: (n: number) => ReactNode; className?: string; dentition?: Dentition; teeth?: readonly Charted[]
}) {
  const row = (numbers: number[]) => numbers.map((n) => toothAt(n, dentition, teeth)).filter((n): n is number => n != null)
  const upper = row(UPPER)
  const lower = row(LOWER)
  const half = (r: number[]) => r.length / 2
  const jaws = (
    <>
      <div className="jaw" role="group" aria-label="Верхняя челюсть">
        <Quadrant side="right" label="Верх · правая сторона" teeth={upper.slice(0, half(upper))} render={render} />
        <Quadrant side="left" label="Верх · левая сторона" teeth={upper.slice(half(upper))} render={render} />
      </div>
      <div className="jaw" role="group" aria-label="Нижняя челюсть">
        <Quadrant side="right" label="Низ · правая сторона" teeth={lower.slice(0, half(lower))} render={render} />
        <Quadrant side="left" label="Низ · левая сторона" teeth={lower.slice(half(lower))} render={render} />
      </div>
    </>
  )
  // Без обёртки — челюсти остаются прямыми детьми блока (как было в медкарте)
  return className ? <div className={className}>{jaws}</div> : jaws
}

/**
 * Четверть челюсти с подписью: на телефоне челюсть — в две строки, и без подписи номера казались вразнобой.
 * Молочных в четверти 5 — колонки уже, и зубы прижаты к середине ряда (data-count, data-side в CSS).
 */
function Quadrant({ side, label, teeth, render }: {
  side: 'right' | 'left'; label: string; teeth: number[]; render: (n: number) => ReactNode
}) {
  return (
    <div className="quadrant">
      <span className="quadrant-label" aria-hidden="true">{label} <span className="num">{teeth[0]}–{teeth[teeth.length - 1]}</span></span>
      <div className="teeth" data-count={teeth.length} data-side={side}>{teeth.map(render)}</div>
    </div>
  )
}
