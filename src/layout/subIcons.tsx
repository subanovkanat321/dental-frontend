import type { CSSProperties } from 'react'

import type { Page } from '../lib/route'
import { SUB_ICONS } from './subIconPaths'

/** Иконка подраздела (украшение: `aria-hidden`, подпись — текст рядом). Нет рисунка — ничего. */
export function SubIcon({ page, sub }: { page: Page; sub: string }) {
  const paths = SUB_ICONS[page]?.[sub]
  if (!paths) return null
  return (
    <svg className="icon sub-ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" style={{ '--sub-ico': `var(--ico-${page})` } as CSSProperties}>
      {paths}
    </svg>
  )
}
