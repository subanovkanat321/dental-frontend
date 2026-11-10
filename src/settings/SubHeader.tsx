import { useBack } from '../lib/back'
import { guarded } from '../lib/unsaved'
import { stickyHead } from '../layout/stickyHead'

/**
 * Шапка пункта «Настроек»: «‹ Настройки» назад (телефон; и стрелка Telegram) и название пункта. Есть
 * несохранённые правки — сначала спросим, выйти ли без сохранения.
 */
export function SubHeader({ title, onBack, slotRef, children }: {
  title: string
  onBack: () => void
  /** Место под инструменты пункта (`HeadTools`, layout/PageHead) — в той же строке, что название */
  slotRef?: (el: HTMLElement | null) => void
  children?: React.ReactNode
}) {
  const back = guarded(onBack)
  // Пункт «Настроек» записан в адресе (#/settings/…): «назад» браузера ведёт в список и так
  useBack(back, { url: true })
  return (
    <header ref={stickyHead} className="toolbar sticky-head page-head">
      {/* Телефон: «‹ Настройки» назад к списку. Компьютер: пункты — в меню слева, назад не нужно —
          мелко «Настройки» над названием пункта, как у подразделов других разделов */}
      <button type="button" className="btn ghost back settings-back" onClick={back}>‹ Настройки</button>
      <div className="sect-titles sub-titles"><span className="sect-crumb">Настройки</span><h1>{title}</h1></div>
      {slotRef && <div className="head-tools" ref={slotRef} />}
      {children}
    </header>
  )
}
