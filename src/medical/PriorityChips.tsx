import { PRIORITIES, PRIORITY, type Priority } from '../lib/planPriority'

/**
 * Срочность этапа одним нажатием — три кнопки «🔴 Срочно · 🟡 Желательно · 🟢 Можно позже» (в «Что сделать» и в правке
 * этапа). Подсказка «что сюда относится» — в title и под кнопками у выбранной.
 */
export function PriorityChips({ value, onChange, note }: { value: Priority; onChange: (p: Priority) => void; note?: string }) {
  return (
    <div className="field plan-priority">
      <span>Срочность</span>
      <div className="chips-pick" role="group" aria-label="Срочность этапа">
        {PRIORITIES.map((p) => (
          <button key={p} type="button" className={`chip prio-chip prio-${PRIORITY[p].tone}`} aria-pressed={value === p}
            title={PRIORITY[p].hint} onClick={() => onChange(p)}>
            <span aria-hidden="true">{PRIORITY[p].icon} </span>{PRIORITY[p].label}
          </button>
        ))}
      </div>
      <span className="hint small">{note ?? PRIORITY[value].hint}</span>
    </div>
  )
}
