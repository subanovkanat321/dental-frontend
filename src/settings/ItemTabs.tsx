/**
 * Вкладки пункта «Настроек», где вместе несколько похожих экранов («Сообщения пациентам»: напоминания, оценка,
 * WhatsApp — SettingsPage, TabbedItem). Без эмодзи (DESIGN.md).
 */
/** Выбранная вкладка — в видимой части ряда (телефон, 5+ вкладок прокручиваются вбок): открыли по ссылке «Дни рождения» — видно, где вы. */
function scrollToChosen(el: HTMLDivElement | null) {
  const chosen = el?.querySelector<HTMLElement>('[aria-selected=true]')
  if (el && chosen && el.scrollWidth > el.clientWidth) el.scrollLeft = Math.max(0, chosen.offsetLeft - 16)
}

export function ItemTabs<T extends string>({ label, tabs, value, onChange }: {
  label: string
  tabs: [T, string][]
  value: T
  onChange: (tab: T) => void
}) {
  return (
    <div ref={scrollToChosen} className="segments tabs item-tabs" role="tablist" aria-label={label}>
      {tabs.map(([key, title]) => (
        <button key={key} type="button" role="tab" aria-selected={value === key} aria-pressed={value === key} onClick={() => onChange(key)}>{title}</button>
      ))}
    </div>
  )
}
