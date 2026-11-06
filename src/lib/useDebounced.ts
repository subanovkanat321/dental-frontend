import { useEffect, useState } from 'react'

/** Пауза перед запросом: не дёргать сервер на каждую букву. */
export function useDebounced(value: string, ms = 300): string {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}
