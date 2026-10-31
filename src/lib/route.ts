import { useEffect, useState } from 'react'

/** Разделы CRM. Адрес — во фрагменте (#/patients): CRM отдаёт nginx одним index.html. */
export type Page = 'schedule' | 'patients' | 'cash' | 'stock' | 'team' | 'clinic' | 'account' | 'platform'

const PAGES: readonly Page[] = ['schedule', 'patients', 'cash', 'stock', 'team', 'clinic', 'account', 'platform']

function current(): Page {
  const name = window.location.hash.replace(/^#\/?/, '')
  return (PAGES as readonly string[]).includes(name) ? (name as Page) : 'schedule'
}

/**
 * Раздел из адреса: обновили страницу или нажали «Назад» в браузере — остаёмся где были.
 * Своя маленькая «маршрутизация» вместо React Router: разделов пока немного, библиотека — лишний вес.
 */
export function usePage(): [Page, (page: Page) => void] {
  const [page, setPage] = useState(current)
  useEffect(() => {
    const onHash = () => setPage(current())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  return [page, (next) => { window.location.hash = `/${next}` }]
}
