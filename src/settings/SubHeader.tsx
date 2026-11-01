import { useBack } from '../lib/back'

/** Шапка пункта «Настроек»: «‹ Настройки» назад (и стрелка Telegram) и название пункта. */
export function SubHeader({ title, onBack, children }: { title: string; onBack: () => void; children?: React.ReactNode }) {
  useBack(onBack)
  return (
    <header className="toolbar">
      <button type="button" className="btn ghost back" onClick={onBack}>‹ Настройки</button>
      <h1>{title}</h1>
      {children}
    </header>
  )
}
