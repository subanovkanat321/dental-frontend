import type { ReactNode } from 'react'

/**
 * Зубы по FDI так, как врач смотрит на пациента: сверху верхняя челюсть (правая сторона
 * пациента — 18…11, левая — 21…28), снизу нижняя (48…41 и 31…38). На большом экране — по 16 в ряд.
 */
const UPPER = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28]
const LOWER = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38]

/**
 * Зубная формула: две челюсти по четвертям. Как выглядит и что делает зуб — решает {@code render}:
 * карта зубов в медкарте и «Зубы этого приёма» в карточке приёма рисуют одну и ту же раскладку.
 */
export function ToothFormula({ render, className }: { render: (n: number) => ReactNode; className?: string }) {
  const jaws = (
    <>
      <div className="jaw" role="group" aria-label="Верхняя челюсть">
        <Quadrant label="Верх · правая сторона" teeth={UPPER.slice(0, 8)} render={render} />
        <Quadrant label="Верх · левая сторона" teeth={UPPER.slice(8)} render={render} />
      </div>
      <div className="jaw" role="group" aria-label="Нижняя челюсть">
        <Quadrant label="Низ · правая сторона" teeth={LOWER.slice(0, 8)} render={render} />
        <Quadrant label="Низ · левая сторона" teeth={LOWER.slice(8)} render={render} />
      </div>
    </>
  )
  // Без обёртки — челюсти остаются прямыми детьми блока (как было в медкарте)
  return className ? <div className={className}>{jaws}</div> : jaws
}

/** Четверть челюсти с подписью: на телефоне челюсть — в две строки, и без подписи номера казались вразнобой. */
function Quadrant({ label, teeth, render }: { label: string; teeth: number[]; render: (n: number) => ReactNode }) {
  return (
    <div className="quadrant">
      <span className="quadrant-label" aria-hidden="true">{label} <span className="num">{teeth[0]}–{teeth[teeth.length - 1]}</span></span>
      <div className="teeth">{teeth.map(render)}</div>
    </div>
  )
}
