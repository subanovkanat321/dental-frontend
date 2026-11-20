/**
 * Число у пункта меню и вкладки подраздела — один компонент на всё меню (компьютер: пункт и подпункт, телефон: вкладка,
 * лист «⌄», раздел внизу). loud — красная точка-счётчик (новое, ждёт действия: вопросы пациентов, просроченные задачи,
 * новые в листе ожидания), иначе — тихое серое число. Больше 99 — «99+». Ноль — ничего.
 * badge — у раздела (сумма подразделов, с подписью для читалок экрана), иначе — у подраздела (подпись — у ссылки).
 */
export function NavCount({ n, loud, badge, label }: { n: number; loud: boolean; badge?: boolean; label?: string }) {
  if (n <= 0) return null
  const cls = `${badge ? 'nav-badge' : 'nav-count'}${loud ? '' : ' quiet'}`
  return label
    ? <span className={cls} aria-label={label}>{n > 99 ? '99+' : n}</span>
    : <span className={cls} aria-hidden="true">{n > 99 ? '99+' : n}</span>
}
