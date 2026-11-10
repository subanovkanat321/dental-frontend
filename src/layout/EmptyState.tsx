import type { ReactNode } from 'react'

/**
 * Тишка «водяным знаком»: силуэт зуба с шарфом и глазами одним цветом (`currentColor`), без щёк и
 * улыбки — узнаётся талисман Tish, но не спорит с текстом. Прозрачность и цвет задаёт CSS
 * (`.empty-mark`): бирюзовый ~20% в светлой теме, светлый — в тёмной.
 */
function TishkaMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="44 26 212 332" aria-hidden="true" focusable="false">
      <path d="M60,110 C60,38 122,28 150,56 C178,28 240,38 240,110 C240,170 226,200 216,250 C206,300 196,332 180,332 C162,332 162,282 150,272 C138,282 138,332 120,332 C104,332 94,300 84,250 C74,200 60,170 60,110 Z"
        fill="currentColor" fillOpacity=".35" stroke="currentColor" strokeWidth="10" strokeLinejoin="round" />
      <path d="M78,214 C110,232 190,232 222,214 L218,240 C186,256 114,256 82,240 Z M196,236 l26,34 l-22,6 Z" fill="currentColor" />
      <ellipse cx="122" cy="150" rx="15" ry="20" fill="currentColor" />
      <ellipse cx="180" cy="150" rx="15" ry="20" fill="currentColor" />
    </svg>
  )
}

/**
 * Пустое состояние: полупрозрачный Тишка, фраза, подсказка и действие — вместо голой серой строки.
 * Обычное — на месте целого экрана или списка (Тишка крупно, по центру); `compact` — мелкий блок
 * внутри карточки (долги, оплаты, снимки): Тишка маленьким значком слева, строкой. `fill` — пустой
 * весь подраздел: без карточки, прямо на фоне страницы, по центру всей свободной высоты до низа окна
 * (Тишка — водяным знаком). В узких местах (карточка справа, форма) — обычный или `compact`.
 */
export function EmptyState({ title, children, action, compact, fill }: {
  title: string
  children?: ReactNode
  action?: ReactNode
  compact?: boolean
  fill?: boolean
}) {
  return (
    <div className={['empty-state', compact ? 'compact' : '', fill ? 'fill' : ''].filter(Boolean).join(' ')}>
      <TishkaMark className="empty-mark" />
      <div className="empty-body">
        <p className="empty-title">{title}</p>
        {children && <p className="hint">{children}</p>}
      </div>
      {action && <div className="empty-action">{action}</div>}
    </div>
  )
}
