import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'

import { useBack } from '../lib/back'

type Point = { x: number; y: number }

/** Перерисовать все штрихи: CSS-пиксели × плотность экрана. Нет 2D-контекста (тесты) — ничего. */
function draw(el: HTMLCanvasElement | null, strokes: Point[][]) {
  const ctx = el?.getContext('2d')
  if (!el || !ctx) return
  const ratio = window.devicePixelRatio || 1
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, el.width, el.height)
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  ctx.lineWidth = 2.4
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = '#111'
  for (const stroke of strokes) {
    ctx.beginPath()
    stroke.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
    if (stroke.length === 1) ctx.lineTo(stroke[0]!.x + 0.1, stroke[0]!.y + 0.1)
    ctx.stroke()
  }
}

/**
 * Подпись пальцем или стилусом на планшете (телефоне) регистратуры: холст поверх CRM, линия рисуется
 * под пальцем (pointer events — мышь, палец и стилус одним кодом). «Готово» — PNG уходит на сервер
 * вместе с отметкой «подписан» и печатается на листе договора. Пустую подпись не отправляем.
 */
export function SignaturePad({ title, saving, error, onDone, onCancel }: {
  title: string
  saving: boolean
  error?: string | null
  onDone: (png: Blob) => void
  onCancel: () => void
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const strokes = useRef<Point[][]>([])
  const drawing = useRef(false)
  const [empty, setEmpty] = useState(true)
  useBack(onCancel)

  // Размер холста в пикселях экрана (на Retina — вдвое плотнее), иначе линия размыта
  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const ratio = window.devicePixelRatio || 1
    el.width = Math.max(1, Math.round((el.clientWidth || 600) * ratio))
    el.height = Math.max(1, Math.round((el.clientHeight || 240) * ratio))
    draw(el, strokes.current)
  }, [])

  const redraw = () => draw(canvas.current, strokes.current)

  const point = (e: PointerEvent<HTMLCanvasElement>): Point => {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const down = (e: PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    drawing.current = true
    strokes.current.push([point(e)])
    setEmpty(false)
    redraw()
  }

  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return
    strokes.current[strokes.current.length - 1]!.push(point(e))
    redraw()
  }

  const up = () => {
    drawing.current = false
  }

  const clear = () => {
    strokes.current = []
    setEmpty(true)
    redraw()
  }

  const done = () => {
    canvas.current?.toBlob((blob) => {
      if (blob) onDone(blob)
    }, 'image/png')
  }

  return createPortal(
    <div className="signature-pad" role="dialog" aria-modal="true" aria-label={title}>
      <div className="signature-card">
        <h2>{title}</h2>
        <p className="hint">Пациент расписывается пальцем или стилусом в рамке. Подпись сохранится к договору и напечатается на листе.</p>
        <canvas ref={canvas} className="signature-canvas" aria-label="Поле для подписи"
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} onPointerCancel={up} />
        {error && <p className="error" role="alert">{error}</p>}
        <div className="actions">
          <button type="button" className="btn ghost" onClick={onCancel}>Отмена</button>
          <button type="button" className="btn" disabled={empty} onClick={clear}>Стереть</button>
          <button type="button" className="btn primary" disabled={empty || saving} onClick={done}>
            {saving ? 'Сохраняем…' : 'Готово — подписан'}</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
