import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { useBack } from '../lib/back'
import { telegram } from '../lib/telegram'
import { ToothFormula } from './ToothFormula'
import type { Dentition } from './dentition'
import { ToothFigure, ToothLegendItem } from './ToothGlyph'
import { TOOTH_STATES, hasSurfaces, surfacesText, type Surface, type ToothState } from './toothStates'
import './toothChart.css'

export type ChartTooth = { number?: number; state?: ToothState; surfaces?: Surface[] }

/**
 * «На весь экран»: карта зубов крупно — показать пациенту на ТВ, мониторе или планшете. Только зубы,
 * поверхности и легенда: ни кнопок правки, ни заметок врача (там бывает рабочее), имя пациента — только
 * если включить (по умолчанию скрыто: экран видят и другие). Нажали зуб — он подсвечен и подписан внизу.
 *
 * В браузере — Fullscreen API (весь монитор, без вкладок); в Telegram Mini App его нет — просто слой
 * на всё окно. Выход — ✕, Esc (Esc не закрывает заодно карточку под слоем) или «назад» в Telegram.
 *
 * @param highlight зубы, отмеченные в этом приёме, — чуть подсвечены
 */
export function ToothFullscreen({ teeth, highlight, patientName, onClose, dentition }: {
  teeth: ChartTooth[]
  highlight?: number[]
  /** Прикус, как на карте (молочные, сменный); по умолчанию постоянные */
  dentition?: Dentition
  patientName?: string
  onClose: () => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const closeBtn = useRef<HTMLButtonElement>(null)
  const [lit, setLit] = useState<number | null>(null)
  const [showName, setShowName] = useState(false)
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  })
  useBack(onClose)

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    closeBtn.current?.focus()
    const el = root.current
    let native = false
    // Fullscreen API — не в Telegram (там нет) и не в старых браузерах; отказ браузера — остаёмся слоем
    if (!telegram() && el?.requestFullscreen && document.fullscreenEnabled) {
      el.requestFullscreen().then(() => { native = true }, () => {})
    }
    // Вышли из полноэкранного кнопкой браузера или Esc (браузер сам снимает режим) — закрываем и слой
    const onChange = () => {
      if (native && !document.fullscreenElement) close.current()
    }
    // В фазе перехвата: Esc закрывает только этот слой, а не карточку приёма под ним
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        e.preventDefault()
        close.current()
      }
    }
    document.addEventListener('fullscreenchange', onChange)
    window.addEventListener('keydown', onKey, true)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      window.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = overflow
      if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => {})
      before?.focus?.()
    }
  }, [])

  const byNumber = new Map(teeth.map((t) => [t.number, t]))
  const visit = new Set(highlight ?? [])
  const counts = teeth.reduce<Partial<Record<ToothState, number>>>((acc, t) => {
    if (t.state) acc[t.state] = (acc[t.state] ?? 0) + 1
    return acc
  }, {})
  const caption = (n: number) => {
    const t = byNumber.get(n)
    const state = t?.state ?? 'HEALTHY'
    const parts = hasSurfaces(state) ? surfacesText(n, t?.surfaces) : ''
    return `Зуб ${n} — ${TOOTH_STATES[state][0].toLowerCase()}${parts ? ` (${parts})` : ''}`
  }

  const tooth = (n: number) => {
    const t = byNumber.get(n)
    const state = t?.state ?? 'HEALTHY'
    return (
      <button key={n} type="button" className={`tooth${lit === n ? ' lit' : ''}${visit.has(n) ? ' visit' : ''}`} data-state={state}
        aria-pressed={lit === n} aria-label={caption(n)} onClick={() => setLit(lit === n ? null : n)}>
        <ToothFigure number={n} state={state} surfaces={t?.surfaces} ring />
      </button>
    )
  }

  return createPortal(
    <div ref={root} className="tooth-fullscreen" role="dialog" aria-modal="true" aria-label="Карта зубов на весь экран">
      <header className="fs-head">
        <h2>Карта зубов{showName && patientName ? <span className="fs-name"> · {patientName}</span> : null}</h2>
        {patientName && (
          <label className="check small">
            <input type="checkbox" checked={showName} onChange={(e) => setShowName(e.target.checked)} /> Имя пациента
          </label>
        )}
        <button ref={closeBtn} type="button" className="btn fs-close" aria-label="Закрыть «На весь экран»" onClick={onClose}>✕</button>
      </header>
      <ToothFormula className="fs-chart" render={tooth} dentition={dentition} teeth={teeth} />
      <footer className="fs-foot">
        <p className="fs-caption" aria-live="polite">
          {lit != null ? caption(lit) : visit.size ? `Отмечены в этом приёме: ${[...visit].sort((a, b) => a - b).join(', ')}` : ''}
        </p>
        <p className="fs-legend">
          {(Object.keys(TOOTH_STATES) as ToothState[]).filter((k) => k !== 'HEALTHY').map((k) => (
            <ToothLegendItem key={k} state={k} label={`${TOOTH_STATES[k][0]}${counts[k] ? ` · ${counts[k]}` : ''}`} />
          ))}
        </p>
      </footer>
    </div>,
    document.body,
  )
}
