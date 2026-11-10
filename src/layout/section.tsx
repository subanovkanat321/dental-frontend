import { useContext, type ReactNode } from 'react'

import type { Page } from '../lib/route'
import { useMedia } from '../lib/useMedia'
import { NavContext } from './useSection'

/**
 * Заголовок раздела с подразделами. Компьютер: мелко «Раздел», крупно — подраздел (подразделы — в
 * меню слева). Телефон: «Пациенты · Записаны ▾» — кнопка, открывает лист снизу со всеми подразделами.
 * Без подразделов — просто заголовок раздела.
 */
export function SectionTitle({ page, title, subTitle, hint }: { page: Page; title: string; subTitle?: string | null; hint?: ReactNode }) {
  const nav = useContext(NavContext)
  const phone = useMedia('(max-width: 760px)')
  if (!subTitle) return <div className="with-hint"><h1>{title}</h1>{hint}</div>
  if (phone && nav) {
    return (
      <div className="with-hint sect-title">
        <h1>
          <button type="button" className="sect-switch" aria-haspopup="dialog" onClick={() => nav.openSheet(page)}>
            <span>{title}</span><span className="sect-dot" aria-hidden="true">·</span><span className="sect-sub">{subTitle}</span>
            <svg className="sect-caret" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
          </button>
        </h1>
        {hint}
      </div>
    )
  }
  return (
    <div className="with-hint sect-title">
      <div className="sect-titles"><span className="sect-crumb">{title}</span><h1>{subTitle}</h1></div>
      {hint}
    </div>
  )
}
