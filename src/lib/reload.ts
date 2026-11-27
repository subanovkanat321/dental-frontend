/** Перезагрузить страницу — новая сессия (cookie) вступает в силу для всего приложения. Отдельно — чтобы тест подменил. */
export function reloadPage(): void {
  window.location.reload()
}
