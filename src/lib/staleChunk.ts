const RELOADED = 'crm.reloadedForUpdate'

/** Куска кода старой версии больше нет на сервере (обновили, пока вкладка была открыта). */
export function isStaleChunk(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error)
  return /dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk/i.test(text)
}

/**
 * Вышла новая версия, а вкладка старая: кусок кода не загрузился — один раз перезагружаемся сами
 * (ErrorBoundary, динамический import атласа). Возвращает true, если это такой случай (перезагрузка
 * уже идёт или уже была — тогда показываем ошибку как есть). Нет сети — это не новая версия: не
 * перезагружаемся в офлайн. Отметку снимает main.tsx через минуту работы без сбоев.
 */
export function reloadForStaleChunk(error: unknown): boolean {
  if (!isStaleChunk(error) || navigator.onLine === false) return false
  let already = false
  try {
    already = sessionStorage.getItem(RELOADED) === '1'
    sessionStorage.setItem(RELOADED, '1')
  } catch {
    // приватный режим — перезагрузимся один раз без отметки
  }
  if (already) return false
  window.location.reload()
  return true
}
