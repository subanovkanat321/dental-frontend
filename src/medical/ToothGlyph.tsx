import { memo, useId } from 'react'

import type { ToothState } from './toothStates'

/**
 * Зуб рисунком: коронка по группе (резец, клык, премоляр, моляр), корни по числу, пульпа и каналы
 * тонкой линией, а состояние из карты — прямо на рисунке. Пути считаются один раз на тип зуба
 * (константы ниже); у каждого из 32 зубов — только выбор типа, масштаб по ширине и поворот для нижней челюсти.
 *
 * Рисуем «как верхний»: корни вверх, коронка внизу (шейка на y=42, режущий край на y=70).
 * Нижний зуб — тот же рисунок, отражённый по вертикали: корни вниз.
 */

type Kind = 'incisor' | 'canine' | 'premolar' | 'molar'
type Root = { d: string; canal: string }
type Shape = { crown: string; roots: Root[]; pulp: string }

const W = 40
const H = 72
const NECK = 46 // корни начинаются под коронкой — без щели на шейке

/** Корень-конус от шейки (xl…xr) к верхушке (ax, ay) и канал по его оси. */
function root(xl: number, xr: number, ax: number, ay: number): Root {
  const mid = (NECK + ay) / 2
  const cx = (xl + xr) / 2
  return {
    // Верхушка скруглена: острые иглы читались как шипы, а не как корни
    d: `M${xl} ${NECK}C${xl} ${mid} ${ax - 3} ${ay + 8} ${ax - 1.5} ${ay + 1.2}Q${ax} ${ay - 0.8} ${ax + 1.5} ${ay + 1.2}C${ax + 3} ${ay + 8} ${xr} ${mid} ${xr} ${NECK}Z`,
    canal: `M${cx} ${NECK - 1}Q${(cx + ax) / 2} ${mid} ${ax} ${ay + 3}`,
  }
}

const CROWN: Record<Kind, string> = {
  // Лопатка: узкая шейка, широкий прямой край
  incisor: 'M13 42C10 46 8.5 56 9 66C9.3 69 11 70 13 70L27 70C29 70 30.7 69 31 66C31.5 56 30 46 27 42Z',
  // Клык: один острый бугор
  canine: 'M12.5 42C9.5 46 8.5 52 9 57C10 62 15 66 20 70C25 66 30 62 31 57C31.5 52 30.5 46 27.5 42Z',
  // Премоляр: округлый, с бугорком посередине
  premolar: 'M12 42C8 45 6.5 50 7 55C7.5 61 12 66 17 68L20 69.5L23 68C28 66 32.5 61 33 55C33.5 50 32 45 28 42Z',
  // Моляр: широкий, два бугра и борозда между ними
  molar: 'M9 42C5 44 3 50 4 56C4.5 62 6 68 11 69C15 70 18 67 20 66C22 67 25 70 29 69C34 68 35.5 62 36 56C37 50 35 44 31 42Z',
}

const PULP: Record<Kind, string> = {
  incisor: 'M18 45Q20 43 22 45L21.2 58Q20 60 18.8 58Z',
  canine: 'M18 45Q20 43 22 45L21.2 59Q20 62 18.8 59Z',
  premolar: 'M15.5 45Q20 43 24.5 45L23.5 55Q20 57.5 16.5 55Z',
  molar: 'M12.5 45Q20 42.5 27.5 45L27 52Q24 50.5 20 53Q16 50.5 13 52Z',
}

const SHAPES = {
  incisor: { crown: CROWN.incisor, pulp: PULP.incisor, roots: [root(13.5, 26.5, 20, 6)] },
  canine: { crown: CROWN.canine, pulp: PULP.canine, roots: [root(13, 27, 20, 2)] },
  premolar1: { crown: CROWN.premolar, pulp: PULP.premolar, roots: [root(12.5, 27.5, 20, 7)] },
  premolar2: { crown: CROWN.premolar, pulp: PULP.premolar, roots: [root(12, 20.5, 15.5, 8), root(19.5, 28, 24.5, 8)] },
  // Верхний моляр: два щёчных корня и нёбный между ними (нёбный — первым, он «позади»)
  molar3: { crown: CROWN.molar, pulp: PULP.molar, roots: [root(16.5, 23.5, 20, 4), root(9, 16.5, 8, 9), root(23.5, 31, 32, 9)] },
  // Нижний моляр: мезиальный и дистальный корни
  molar2: { crown: CROWN.molar, pulp: PULP.molar, roots: [root(9.5, 19.5, 11, 9), root(20.5, 30.5, 29, 9)] },
} satisfies Record<string, Shape>

type ShapeKey = keyof typeof SHAPES

/** Что за зуб по номеру FDI: форма и относительная ширина (центральный резец верхней челюсти шире бокового и т. д.). */
function anatomy(n: number): { shape: ShapeKey; width: number } {
  const upper = isUpperTooth(n)
  const pos = n % 10
  if (pos <= 2) return { shape: 'incisor', width: upper ? (pos === 1 ? 1 : 0.84) : 0.74 }
  if (pos === 3) return { shape: 'canine', width: 0.92 }
  if (pos <= 5) return { shape: upper && pos === 4 ? 'premolar2' : 'premolar1', width: 0.86 }
  return { shape: upper ? 'molar3' : 'molar2', width: pos === 8 ? 0.9 : 1 }
}

/** Верхняя челюсть — четверти 1 и 2 (у молочных зубов — 5 и 6). */
function isUpperTooth(n: number): boolean {
  const q = Math.floor(n / 10)
  return q === 1 || q === 2 || q === 5 || q === 6
}

/** Молочный зуб (четверти 5–8): рисуем мельче. В карте сейчас только постоянные, но формула готова. */
function isPrimaryTooth(n: number): boolean {
  return Math.floor(n / 10) >= 5
}

// Винт импланта вместо корня: тело с резьбой и абатмент под коронкой
const SCREW = 'M15.5 46L15.5 15Q15.5 9 20 7Q24.5 9 24.5 15L24.5 46Z'
const THREADS = [14, 19, 24, 29, 34, 39].map((y) => `M15.5 ${y + 2}L24.5 ${y}`).join('')
const ABUTMENT = 'M16.5 40L23.5 40L23 46L17 46Z'

export const ToothGlyph = memo(function ToothGlyph({ number, state = 'HEALTHY', className }: {
  number: number
  state?: ToothState
  className?: string
}) {
  const clip = `tc${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const { shape, width } = anatomy(number)
  const s = SHAPES[shape]
  const upper = isUpperTooth(number)
  const scale = width * (isPrimaryTooth(number) ? 0.8 : 1)
  // Ширина — масштабом вокруг середины; нижний зуб — отражение по вертикали
  const transform = `translate(${W / 2} ${upper ? 0 : H}) scale(${scale} ${upper ? 1 : -1}) translate(${-W / 2} 0)`
  const missing = state === 'MISSING'
  const implant = state === 'IMPLANT'

  return (
    <svg className={`tooth-glyph${className ? ` ${className}` : ''}`} viewBox={`0 0 ${W} ${H}`} data-state={state}
      data-shape={shape} aria-hidden="true" focusable="false">
      <g transform={transform}>
        {(state === 'CARIES' || state === 'FILLING') && (
          <clipPath id={clip}><path d={s.crown} /></clipPath>
        )}
        {implant ? (
          <g data-part="implant">
            <path className="tg-screw" d={SCREW} />
            <path className="tg-thread" d={THREADS} />
            <path className="tg-screw" d={ABUTMENT} />
          </g>
        ) : (
          s.roots.map((r, i) => <path key={i} className="tg-root" d={r.d} />)
        )}
        <path className="tg-crown" d={s.crown} data-part={state === 'CROWN' ? 'crown-cap' : undefined} />
        {!missing && !implant && state !== 'CROWN' && (
          <g className="tg-pulp" data-part="pulp">
            <path d={s.pulp} />
            {s.roots.map((r, i) => <path key={i} className="tg-canal" d={r.canal} />)}
          </g>
        )}
        {state === 'CARIES' && (
          <g clipPath={`url(#${clip})`} data-part="caries">
            <path className="tg-caries" d="M21 58.5C23.5 56 28.5 56.5 29 60C29.5 63.5 26 65.5 23 64.5C20.5 63.7 19.5 60.5 21 58.5Z" />
            <circle className="tg-caries" cx="14.5" cy="63.5" r="1.6" />
          </g>
        )}
        {state === 'FILLING' && (
          <ellipse className="tg-filling" data-part="filling" cx="20" cy="66" rx="9.5" ry="6" clipPath={`url(#${clip})`} />
        )}
        {state === 'CROWN' && <path className="tg-crown-margin" d="M10 46.5Q20 49.5 30 46.5" />}
        {state === 'TREATING' && <circle className="tg-mark" data-part="treating" cx="20" cy="56" r="3.2" />}
      </g>
    </svg>
  )
})

/**
 * Содержимое кнопки зуба в формуле: рисунок и номер FDI. Номера смотрят к линии смыкания —
 * у верхних зубов подпись под рисунком, у нижних над ним, как в бумажной формуле.
 */
export function ToothFigure({ number, state }: { number: number; state?: ToothState }) {
  const glyph = <ToothGlyph number={number} state={state} />
  const label = <span className="tooth-number">{number}</span>
  return isUpperTooth(number) ? <>{glyph}{label}</> : <>{label}{glyph}</>
}

/** Легенда карты: тот же рисунок зуба (первый моляр), что и в формуле. */
export function ToothLegendItem({ state, label }: { state: ToothState; label: string }) {
  return (
    <span className="tooth-legend-item">
      <ToothGlyph number={36} state={state} className="mini" />
      {label}
    </span>
  )
}
