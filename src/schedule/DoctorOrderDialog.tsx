import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import type { Schemas } from '../api/client'
import { colorOf, initials } from '../lib/avatars'
import { useBack } from '../lib/back'

type Doctor = Schemas['DoctorView']

/**
 * «Порядок врачей»: список с кнопками ↑ ↓ — без перетаскивания: на телефоне палец промахивается
 * и прокручивает страницу. «Сохранить» — запомнить на этом устройстве; «Как было» — забыть свой
 * порядок (тогда свой врач первым, остальные — как в клинике). Компьютер — окно по центру,
 * телефон — лист снизу, как окно подтверждения (layout/Confirm.tsx).
 */
export function DoctorOrderDialog({ doctors, myDoctorId, colorDoctors, onSave, onReset, onClose }: {
  /** Врачи в текущем порядке */
  doctors: Doctor[]
  myDoctorId?: number | null
  /** Врачи клиники в исходном порядке — по ним цвет врача (colorOf), он не зависит от порядка */
  colorDoctors: Doctor[]
  onSave: (ids: number[]) => void
  onReset: () => void
  onClose: () => void
}) {
  const [list, setList] = useState(doctors)
  const saveRef = useRef<HTMLButtonElement>(null)
  useBack(onClose)
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null
    saveRef.current?.focus()
    return () => back?.focus?.()
  }, [])
  const move = (from: number, to: number) => {
    if (to < 0 || to >= list.length) return
    const next = [...list]
    const [d] = next.splice(from, 1)
    next.splice(to, 0, d!)
    setList(next)
  }
  const phone = typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 640px)').matches
  const nameOf = (d: Doctor) => `${d.fullName ?? ''}${d.id === myDoctorId ? ' (я)' : ''}`

  return createPortal(
    <div className="ui-select-backdrop confirm-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="doctor-order-title" className={phone ? 'confirm doctor-order sheet' : 'confirm doctor-order'}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            onClose()
          }
        }}>
        <div>
          <h2 id="doctor-order-title">Порядок врачей</h2>
          <p className="hint">Первые — слева в расписании. Запоминается на этом устройстве.</p>
        </div>
        <ol className="doctor-order-list" aria-label="Порядок врачей">
          {list.map((d, i) => (
            <li key={d.id}>
              <span className="doctor-order-n num" aria-hidden="true">{i + 1}</span>
              <span className="avatar" style={{ background: colorOf(colorDoctors, d.id) }} aria-hidden="true">{initials(d.fullName)}</span>
              <span className="doctor-order-name">{nameOf(d)}</span>
              <button type="button" className="btn icon" aria-label={`Выше: ${d.fullName}`} disabled={i === 0} onClick={() => move(i, i - 1)}>↑</button>
              <button type="button" className="btn icon" aria-label={`Ниже: ${d.fullName}`} disabled={i === list.length - 1} onClick={() => move(i, i + 1)}>↓</button>
            </li>
          ))}
        </ol>
        <div className="confirm-actions">
          <button type="button" className="btn ghost" onClick={onReset}>Как было</button>
          <button type="button" className="btn" onClick={onClose}>Отмена</button>
          <button ref={saveRef} type="button" className="btn primary" onClick={() => onSave(list.map((d) => d.id!))}>Сохранить</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
