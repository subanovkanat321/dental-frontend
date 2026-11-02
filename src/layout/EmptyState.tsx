import type { ReactNode } from 'react'

/**
 * Пустое состояние списка: значок на мягкой плашке, короткая фраза, подсказка и действие — вместо
 * голой серой строки. `compact` — внутри карточки (долги, оплаты), обычное — на месте целого списка.
 */
export function EmptyState({ icon, title, children, action, compact }: {
  icon: string
  title: string
  children?: ReactNode
  action?: ReactNode
  compact?: boolean
}) {
  return (
    <div className={compact ? 'empty-state compact' : 'empty-state'}>
      <span className="empty-ico" aria-hidden="true">{icon}</span>
      <div className="empty-body">
        <p className="empty-title">{title}</p>
        {children && <p className="hint">{children}</p>}
      </div>
      {action && <div className="empty-action">{action}</div>}
    </div>
  )
}
