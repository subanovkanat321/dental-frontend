import { useBack } from '../lib/back'
import { guarded } from '../lib/unsaved'
import { stickyHead } from '../layout/stickyHead'

/**
 * Шапка пункта «Настроек»: «‹ Настройки» назад (и стрелка Telegram) и название пункта. Есть
 * несохранённые правки — сначала спросим, выйти ли без сохранения.
 */
export function SubHeader({ title, onBack, children }: { title: string; onBack: () => void; children?: React.ReactNode }) {
  const back = guarded(onBack)
  // Пункт «Настроек» записан в адресе (#/settings/…): «назад» браузера ведёт в список и так
  useBack(back, { url: true })
  return (
    <header ref={stickyHead} className="toolbar sticky-head">
      <button type="button" className="btn ghost back" onClick={back}>‹ Настройки</button>
      <h1>{title}</h1>
      {children}
    </header>
  )
}
