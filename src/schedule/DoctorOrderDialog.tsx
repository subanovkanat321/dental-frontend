import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import type { Schemas } from '../api/client'
import { colorOf, initials } from '../lib/avatars'
import { useBack } from '../lib/back'

type Doctor = Schemas['DoctorView']

/**
 * «Врачи в расписании»: у каждого врача галочка «показывать в „Все врачи“» и кнопки ↑ ↓ — порядок
 * (без перетаскивания: на телефоне палец промахивается и прокручивает страницу). Одно окно, а не два:
 * при 10+ врачах «кого видеть» и «в каком порядке» решают вместе. Последнюю галочку снять нельзя —
 * пустое «Все врачи» бессмысленно. «Сохранить» — запомнить на этом устройстве; «Как было» — забыть
 * и порядок, и скрытых (свой врач первым, видны все). Компьютер — окно по центру, телефон — лист
 * снизу, как окно подтверждения (layout/Confirm.tsx).
 */
export function DoctorOrderDialog({ doctors, hidden = [], myDoctorId, colorDoctors, onSave, onReset, onClose }: {
  /** Врачи в текущем порядке */
  doctors: Doctor[]
  /** Кто сейчас скрыт в «Все врачи» (schedule/doctorVisibility.ts) */
  hidden?: readonly number[]
  myDoctorId?: number | null
  /** Врачи клиники в исходном порядке — по ним цвет врача (colorOf), он не зависит от порядка */
  colorDoctors: Doctor[]
  /** Порядок id и скрытые id */
  onSave: (ids: number[], hidden: number[]) => void
  onReset: () => void
  onClose: () => void
}) {
  const [list, setList] = useState(doctors)
  // Скрытых, которых нет в списке (врача удалили), не тащим; все скрыты (старый выбор) — показываем всех
  const [off, setOff] = useState<Set<number>>(() => {
    const set = new Set(doctors.map((d) => d.id).filter((id) => hidden.includes(id)))
    return set.size >= doctors.length ? new Set() : set
  })
  const shownCount = list.length - off.size
  const toggle = (id: number) => {
    const next = new Set(off)
    if (next.has(id)) next.delete(id)
    else if (shownCount > 1) next.add(id)
    setOff(next)
  }
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
          <h2 id="doctor-order-title">Врачи в расписании</h2>
          <p className="hint">Галочка — колонка в «Все врачи», первые — слева. Скрытого врача можно открыть отдельно. Запоминается на этом устройстве.</p>
        </div>
        <ol className="doctor-order-list" aria-label="Врачи в расписании">
          {list.map((d, i) => {
            const shown = !off.has(d.id)
            const last = shown && shownCount === 1
            return (
            <li key={d.id} className={shown ? undefined : 'off'}>
              {/* label вокруг галочки, кружка и имени — нажать можно на всю строку слева от ↑ ↓ */}
              <label className="doctor-order-show" title={last ? 'Хотя бы один врач должен быть в «Все врачи»' : undefined}>
                <input type="checkbox" checked={shown} disabled={last} aria-label={`Показывать: ${d.fullName}`} onChange={() => toggle(d.id)} />
                <span className="avatar" style={{ background: colorOf(colorDoctors, d.id) }} aria-hidden="true">{initials(d.fullName)}</span>
                <span className="doctor-order-name">{nameOf(d)}{shown ? '' : <span className="hint"> · скрыт</span>}</span>
              </label>
              <button type="button" className="btn icon" aria-label={`Выше: ${d.fullName}`} disabled={i === 0} onClick={() => move(i, i - 1)}>↑</button>
              <button type="button" className="btn icon" aria-label={`Ниже: ${d.fullName}`} disabled={i === list.length - 1} onClick={() => move(i, i + 1)}>↓</button>
            </li>
            )
          })}
        </ol>
        <div className="confirm-actions">
          <button type="button" className="btn ghost" onClick={onReset}>Как было</button>
          <button type="button" className="btn" onClick={onClose}>Отмена</button>
          <button ref={saveRef} type="button" className="btn primary" onClick={() => onSave(list.map((d) => d.id), list.map((d) => d.id).filter((id) => off.has(id)))}>Сохранить</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
