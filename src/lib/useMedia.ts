import { useEffect, useState } from 'react'

/** Совпадает ли медиазапрос сейчас (без matchMedia — тесты, старые браузеры — нет). */
export function matches(query: string): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(query).matches
}

/** Медиазапрос, который следит за шириной окна: сузили окно, повернули телефон — перерисовать. */
export function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => matches(query))
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const list = window.matchMedia(query)
    const onChange = () => setOn(list.matches)
    onChange()
    list.addEventListener?.('change', onChange)
    return () => list.removeEventListener?.('change', onChange)
  }, [query])
  return on
}
