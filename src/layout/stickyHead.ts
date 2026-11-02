/**
 * Шапка раздела (заголовок, вкладки, поиск, фильтры), которая на компьютере остаётся наверху при
 * прокрутке длинного списка (CSS `.sticky-head`): `<header ref={stickyHead} className="toolbar sticky-head">`.
 * Её высоту кладём в `--head-h` — под ней прилипают шапки таблиц; класс `stuck` — лёгкая тень,
 * когда список уже уехал под шапку. Ref-функция одна на всё приложение: React вызывает её при
 * появлении шапки и убирает подписки, когда шапка исчезла.
 */
export function stickyHead(el: HTMLElement | null): (() => void) | void {
  if (!el) return
  const root = document.documentElement
  const size = () => root.style.setProperty('--head-h', `${el.offsetHeight}px`)
  size()
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(size) : null
  observer?.observe(el)
  const onScroll = () => el.classList.toggle('stuck', window.scrollY > 8)
  onScroll()
  window.addEventListener('scroll', onScroll, { passive: true })
  return () => {
    observer?.disconnect()
    window.removeEventListener('scroll', onScroll)
    root.style.removeProperty('--head-h')
  }
}
