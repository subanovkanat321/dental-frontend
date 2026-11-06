import { useEffect, type RefObject } from 'react'

/** Боковые панели рабочей области: карточка справа (приём, пациент, материал, формы «Настроек») и «Сводка дня». */
const PANELS = '.panel, .day-summary'
/** Отступ панели от края окна, как у `top: 16px` в CSS. */
const GAP = 16

/**
 * Панель справа на компьютере — `position: sticky; top: 16px`, прокрутка — внутри неё. Только
 * прилипает она, когда прокрутили страницу, а до этого стоит ниже — под шапкой раздела и
 * напоминаниями. С высотой «окно минус 32px» её низ уходил за край экрана: кнопки внизу
 * обрезаны, а колесо мыши/тачпада крутит саму панель и до низа страницы не доходит
 * (браузер не передаёт прокрутку странице в том же жесте). Поэтому высоту считаем от того места,
 * где панель сейчас: в `--panel-top` — её верх на экране (не меньше 16px), CSS берёт
 * `max-height: calc(100dvh - var(--panel-top) - 16px)` — низ панели всегда в окне.
 *
 * Один обработчик на всю рабочую область: панели появляются и пропадают при каждом действии,
 * поэтому следим за изменениями внутри неё (MutationObserver), прокруткой и размером окна —
 * не чаще раза за кадр.
 */
export function useFitPanels(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const area = root.current
    if (!area) return
    let frame = 0
    const fit = () => {
      frame = 0
      for (const panel of area.querySelectorAll<HTMLElement>(PANELS)) {
        const top = `${Math.max(GAP, Math.round(panel.getBoundingClientRect().top))}px`
        if (panel.style.getPropertyValue('--panel-top') !== top) panel.style.setProperty('--panel-top', top)
      }
    }
    const later = () => {
      if (!frame) frame = requestAnimationFrame(fit)
    }
    fit()
    const observer = typeof MutationObserver === 'function' ? new MutationObserver(later) : null
    observer?.observe(area, { childList: true, subtree: true })
    window.addEventListener('scroll', later, { passive: true })
    window.addEventListener('resize', later)
    return () => {
      observer?.disconnect()
      window.removeEventListener('scroll', later)
      window.removeEventListener('resize', later)
      cancelAnimationFrame(frame)
    }
  }, [root])
}
