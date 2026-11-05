/**
 * Вкладки пункта «Настроек», где вместе несколько похожих экранов («Рабочее время»: врачи, смены,
 * перерывы; «Откуда приходят пациенты»: варианты и промокоды). Без эмодзи (DESIGN.md).
 */
export function ItemTabs<T extends string>({ label, tabs, value, onChange }: {
  label: string
  tabs: [T, string][]
  value: T
  onChange: (tab: T) => void
}) {
  return (
    <div className="segments tabs" role="tablist" aria-label={label}>
      {tabs.map(([key, title]) => (
        <button key={key} type="button" role="tab" aria-selected={value === key} aria-pressed={value === key} onClick={() => onChange(key)}>{title}</button>
      ))}
    </div>
  )
}
