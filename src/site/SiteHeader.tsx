import type { MouseEvent, ReactNode } from 'react'

import { cameFromSite, SITE_HOME } from './web'

/**
 * Шапка страниц сайта: «‹ Назад» слева и знак Tish справа — во встроенном браузере Instagram
 * своей кнопки «назад» почти не видно. Справа — по желанию переключатель языка (страницы клиники).
 */
export function SiteHeader({ back = 'Назад', children }: { back?: string; children?: ReactNode }) {
  const goBack = (e: MouseEvent) => {
    if (!cameFromSite()) return
    e.preventDefault()
    window.history.back()
  }
  return (
    <nav className="site-top" aria-label="Навигация">
      <a className="site-back" href={SITE_HOME} onClick={goBack}><span aria-hidden="true">‹</span> {back}</a>
      {children ?? (
        <a className="site-brand" href={SITE_HOME}>
          <img src={`${import.meta.env.BASE_URL}tishka-icon.svg`} alt="" width={16} height={24} /> Tish</a>
      )}
    </nav>
  )
}
