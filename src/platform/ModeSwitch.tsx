import { HeadTools } from '../layout/PageHead'
import type { ModeOption } from './modes'

/**
 * Переключатель режима — залитые таблетки (`.segments`, DESIGN.md → «Переключатели третьего уровня») в строке
 * шапки подраздела, первым среди его инструментов. Один режим (менеджеру «Обратная связь» — только опросы) — без
 * переключателя.
 */
export function ModeSwitch<T extends string>({ label, options, value, onChange }: {
  label: string
  options: readonly ModeOption<T>[]
  value: T
  onChange: (mode: T) => void
}) {
  if (options.length < 2) return null
  return (
    <HeadTools>
      <div className="segments platform-modes" role="group" aria-label={label}>
        {options.map((o) => (
          <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>{o.label}</button>
        ))}
      </div>
    </HeadTools>
  )
}
