import type { KeyboardEvent } from 'react'

import { SURFACES, surfaceLayout, surfaceLetter, surfaceName, surfacesText, type Side, type Surface, type ToothState } from './toothStates'
import './toothChart.css'

/**
 * Кружок из пяти поверхностей зуба, как в бумажной зубной формуле: центр — окклюзионная (у резцов и
 * клыков — режущий край), по кругу — мезиальная, дистальная, вестибулярная и оральная.
 *
 * Стороны — как на карте, где врач смотрит на пациента: вестибулярная всегда «наружу» от линии смыкания
 * (у верхних зубов — сверху, у нижних — снизу), мезиальная — к середине ряда (у правой стороны пациента —
 * справа на экране, у левой — слева). Без номера (несколько зубов сразу) — общая раскладка с буквами «О» и «Я/Н».
 */


const C = 50
const R = 46
const r = 19

function point(radius: number, deg: number): string {
  const a = (deg * Math.PI) / 180
  return `${(C + radius * Math.cos(a)).toFixed(2)} ${(C + radius * Math.sin(a)).toFixed(2)}`
}

/** Сектор кольца от угла from до to (по часовой, 0° — вправо). */
function sector(from: number, to: number): string {
  return `M${point(R, from)}A${R} ${R} 0 0 1 ${point(R, to)}L${point(r, to)}A${r} ${r} 0 0 0 ${point(r, from)}Z`
}

const SECTORS: Record<Side, { d: string; label: [number, number] }> = {
  top: { d: sector(225, 315), label: [50, 18] },
  right: { d: sector(315, 405), label: [82, 50] },
  bottom: { d: sector(45, 135), label: [50, 82] },
  left: { d: sector(135, 225), label: [18, 50] },
}

/**
 * @param value отмеченные поверхности
 * @param onChange есть — кружок можно нажимать (выбор поверхностей); нет — только показывает
 * @param state цвет отмеченных — как у состояния на рисунке зуба (кариес, пломба, лечится)
 */
export function SurfaceDiagram({ number, value, onChange, state, className, label }: {
  number?: number
  value: readonly Surface[]
  onChange?: (next: Surface[]) => void
  state?: ToothState | null
  className?: string
  label?: string
}) {
  const layout = surfaceLayout(number)
  const toggle = (s: Surface) => {
    if (!onChange) return
    const on = value.includes(s)
    onChange(SURFACES.filter((x) => (x === s ? !on : value.includes(x))))
  }
  const onKey = (s: Surface) => (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      toggle(s)
    }
  }
  const interactive = Boolean(onChange)
  const part = (s: Surface, d: string | null, at: [number, number]) => {
    const on = value.includes(s)
    const shape = d ? <path className="sd-seg" d={d} /> : <circle className="sd-seg" cx={C} cy={C} r={r} />
    const letter = interactive && <text className="sd-letter" x={at[0]} y={at[1]} dominantBaseline="central" textAnchor="middle">{surfaceLetter(s, number)}</text>
    return interactive ? (
      <g key={s} role="button" tabIndex={0} aria-pressed={on} data-surface={s} data-on={on || undefined}
        aria-label={`${surfaceName(s, number)} (${surfaceLetter(s, number)})`}
        onClick={() => toggle(s)} onKeyDown={onKey(s)}>
        <title>{surfaceName(s, number)}</title>
        {shape}{letter}
      </g>
    ) : (
      <g key={s} data-surface={s} data-on={on || undefined}>{shape}</g>
    )
  }
  const text = number != null ? surfacesText(number, value) : value.map((s) => surfaceLetter(s)).join('')
  return (
    <svg className={`surface-diagram${interactive ? ' interactive' : ''}${className ? ` ${className}` : ''}`} viewBox="0 0 100 100"
      data-state={state ?? undefined} role={interactive ? 'group' : undefined}
      aria-label={interactive ? (label ?? 'Поверхности зуба') : undefined} aria-hidden={interactive ? undefined : true}
      focusable="false" data-text={text || undefined}>
      {(Object.keys(SECTORS) as Side[]).map((side) => part(layout[side], SECTORS[side].d, SECTORS[side].label))}
      {part('O', null, [C, C])}
    </svg>
  )
}

/** Выбор поверхностей в редакторе зуба: кружок и запись «Отмечено: МО» рядом. */
export function SurfacePicker({ number, value, onChange, state }: {
  number?: number
  value: Surface[]
  onChange: (next: Surface[]) => void
  state?: ToothState | null
}) {
  const text = number != null ? surfacesText(number, value) : value.map((s) => surfaceLetter(s)).join(', ')
  return (
    <div className="surface-picker">
      <SurfaceDiagram number={number} value={value} onChange={onChange} state={state}
        label={number != null ? `Поверхности зуба ${number}` : 'Поверхности выбранных зубов'} />
      <div className="surface-picker-text">
        <span className="field-label">Поверхности — необязательно</span>
        <span className="hint small" aria-live="polite">
          {text ? <>Отмечено: <b className="num">{text}</b></> : 'Не отмечены — весь зуб. Нажмите на части кружка.'}
        </span>
        {value.length > 0 && <button type="button" className="link" onClick={() => onChange([])}>Снять поверхности</button>}
      </div>
    </div>
  )
}
