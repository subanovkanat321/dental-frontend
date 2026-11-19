import { Fragment, useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { useBack } from '../lib/back'
import { useSwipeDown } from './useSwipeDown'

export type ActionItem = {
  label: string
  /** Нажатие; у пункта-ссылки (href) — событие ссылки: preventDefault отменит переход */
  onSelect: (e?: ReactMouseEvent) => void
  /** Пункт-ссылка (tel:, sms:) — переход по ссылке надёжнее открывает звонилку и «Сообщения», чем из скрипта */
  href?: string
  /** Опасное действие (неявка, отмена) — красным */
  danger?: boolean
  disabled?: boolean
  /** Почему пункт недоступен или что он сделает — мелко под подписью («с дня приёма») */
  hint?: string
  /** Эмодзи перед подписью (статусы приёма: 🟢 Пришёл) */
  icon?: string
  /** Выбор одного из (статус приёма): true — текущий, с ✓ (role=menuitemradio); undefined — обычный пункт */
  checked?: boolean
  /** Подзаголовок группы («Связаться», «Отправить в WhatsApp») — ставится перед первым пунктом группы */
  group?: string
}

const PHONE = '(max-width: 640px)'
const isPhone = () => typeof window.matchMedia === 'function' && window.matchMedia(PHONE).matches

/**
 * Кнопка с меню действий: пилюля статуса приёма «🟢 Пришёл ▾», «📞 Связаться ▾». Компьютер — список под кнопкой, телефон — нижний лист
 * (как у Select): пальцем по крупным пунктам, закрыть — фон, свайп вниз или «назад».
 * Доступность: aria-haspopup=menu и aria-expanded у кнопки, role=menu/menuitem у списка; открыли — фокус на
 * первый пункт, ↑/↓ — по пунктам, Esc закрывает только меню (не карточку под ним) и возвращает фокус на кнопку.
 */
export function ActionMenu({ label, items, className = 'btn', disabled, content, buttonLabel }: {
  /** Подпись кнопки и имя меню для скринридера */
  label: string
  items: ActionItem[]
  className?: string
  disabled?: boolean
  /** Своё содержимое кнопки вместо подписи (пилюля статуса: значок и слово); ▾ ставится само */
  content?: ReactNode
  /** Имя кнопки для скринридера, если отличается от подписи («Статус: Пришёл») */
  buttonLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [sheet, setSheet] = useState(false)
  // Внизу экрана (кнопка в конце карточки приёма) список открывается вверх — иначе его обрезал бы край панели
  const [up, setUp] = useState(false)
  const wrap = useRef<HTMLSpanElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const id = useId()

  const close = (focusBack = true) => {
    setOpen(false)
    if (focusBack) button.current?.focus({ preventScroll: true })
  }
  useBack(open ? () => close(false) : null)
  useSwipeDown(menu, open && sheet ? () => close(false) : null)

  useEffect(() => {
    if (!open) return
    menu.current?.querySelector<HTMLButtonElement>('[role^=menuitem]:not(:disabled):not([aria-checked=true])')?.focus({ preventScroll: true })
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Esc закрывает меню, а не карточку приёма под ним (её Esc слушает window — до него не дойдёт)
      e.stopPropagation()
      e.preventDefault()
      close()
    }
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (wrap.current?.contains(t) || menu.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('keydown', onKey, true)
    // На телефоне фон листа сам закрывает по нажатию: pointerdown ловит только компьютерный список
    if (!sheet) document.addEventListener('pointerdown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('pointerdown', onDown)
    }
  }, [open, sheet])

  const onMenuKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const list = [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role^=menuitem]:not(:disabled)') ?? [])]
    const at = list.indexOf(document.activeElement as HTMLButtonElement)
    list[(at + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length]?.focus()
  }

  const list = (
    <div ref={menu} id={id} role="menu" aria-label={label} className={['pop-menu action-menu', sheet && 'sheet', !sheet && up && 'up'].filter(Boolean).join(' ')} onKeyDown={onMenuKey}>
      {items.map((i, at) => (
        <Fragment key={`${i.group ?? ''}-${i.label}`}>
          {i.group && i.group !== items[at - 1]?.group && <div className="menu-group" role="presentation">{i.group}</div>}
          {(() => {
            const className = ['menu-item', i.danger && 'danger', i.checked && 'checked'].filter(Boolean).join(' ')
            const inner = (
              <>
                {i.icon && <span className="menu-emoji" aria-hidden="true">{i.icon}</span>}
                {i.hint ? <span className="menu-text"><span>{i.label}</span>{' '}<span className="menu-hint">{i.hint}</span></span> : <span className="menu-text">{i.label}</span>}
                {i.checked && <span className="menu-check" aria-hidden="true">✓</span>}
              </>
            )
            return i.href && !i.disabled
              ? <a role="menuitem" className={className} href={i.href} onClick={(e) => { close(false); i.onSelect(e) }}>{inner}</a>
              : (
                <button type="button" role={i.checked === undefined ? 'menuitem' : 'menuitemradio'} aria-checked={i.checked}
                  className={className} disabled={i.disabled} onClick={() => { close(false); i.onSelect() }}>{inner}</button>
              )
          })()}
        </Fragment>
      ))}
    </div>
  )

  return (
    <span className="action-menu-wrap" ref={wrap}>
      <button ref={button} type="button" className={className} disabled={disabled} aria-haspopup="menu" aria-expanded={open} aria-label={buttonLabel}
        aria-controls={open ? id : undefined} onClick={() => {
          setSheet(isPhone())
          const below = window.innerHeight - (button.current?.getBoundingClientRect().bottom ?? 0)
          setUp(below < items.length * 52 + 24)
          setOpen((v) => !v)
        }}>
        {content ?? label} <span aria-hidden="true" className="action-menu-caret">▾</span>
      </button>
      {open && (sheet
        ? createPortal(<div className="ui-select-backdrop" onClick={(e) => e.target === e.currentTarget && close(false)}>{list}</div>, document.body)
        : list)}
    </span>
  )
}
