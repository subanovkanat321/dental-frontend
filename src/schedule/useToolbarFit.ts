import { useLayoutEffect, type RefObject } from 'react'

/** Сколько ступеней сжатия у действий шапки: 1 — «Сводка дня» только значком. */
const MAX_LEVEL = 1

/**
 * Шапка «Расписания» на компьютере — одной строкой при любом тексте: обычный или крупный «Размер
 * текста», зум браузера 125%, ноутбук 1366. Порогов в пикселях нет — они разные при каждом масштабе;
 * вместо них меряем: группа действий (.toolbar-actions) встала на первую строку? Нет — следующая
 * ступень (data-fit на шапке, стили в styles.css). Ступени кончились — группа целиком уходит строкой
 * ниже, но не делится (внутри nowrap).
 *
 * Меряем до отрисовки (useLayoutEffect) — без мигания; при смене ширины шапки (окно, зум, панель
 * справа) — ResizeObserver. key — содержимое шапки (дата, число записей…): поменялось — перемерить.
 */
export function useToolbarFit(ref: RefObject<HTMLElement | null>, key: string) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const fit = () => {
      const group = el.querySelector<HTMLElement>('.toolbar-actions')
      const first = el.firstElementChild as HTMLElement | null
      if (!group || !first) return
      for (let level = 0; level <= MAX_LEVEL; level++) {
        el.dataset.fit = String(level)
        const head = first.getBoundingClientRect()
        // Без раскладки (тесты в jsdom) размеров нет — оставляем полный вид
        if (head.height === 0) return
        if (group.getBoundingClientRect().top < head.bottom) return
      }
    }
    fit()
    if (typeof ResizeObserver !== 'function') return
    // Только ширина: высота шапки меняется от нашей же ступени — без лишних кругов
    let width = el.getBoundingClientRect().width
    const observer = new ResizeObserver(() => {
      const next = el.getBoundingClientRect().width
      if (next === width) return
      width = next
      fit()
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref, key])
}
