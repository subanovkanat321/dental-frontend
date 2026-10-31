/** Шапка пункта «Настроек»: «‹ Настройки» назад и название пункта. */
export function SubHeader({ title, onBack, children }: { title: string; onBack: () => void; children?: React.ReactNode }) {
  return (
    <header className="toolbar">
      <button type="button" className="btn ghost back" onClick={onBack}>‹ Настройки</button>
      <h1>{title}</h1>
      {children}
    </header>
  )
}
