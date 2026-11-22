import { toBlob } from 'html-to-image'

/**
 * Лист печати (`.print-sheet`) картинкой PNG — «📷 Отправить листом». Грузится отдельным кусочком только по нажатию
 * (import('./sheetImage')): кто листом не отправляет, тот его и не скачивает.
 *
 * Как рисуем: копию листа кладём за край экрана в `.sheet-capture` — там он всегда шириной A4 (794 точки CSS), даже на
 * телефоне, где на экране лист ужат (print.css), и не короче листа A4. html-to-image переносит в копию вычисленные стили
 * каждого элемента, шрифты (Golos Text, Geologica) встраивает из наших же @font-face, всё вместе — SVG с foreignObject,
 * которое браузер рисует на canvas → PNG. Рисунки зубов — встроенный SVG, их браузер рисует как есть. Плотность ×2 —
 * текст в мессенджере читается при увеличении.
 *
 * Одно «но»: стили SVG-деталей html-to-image не переносит — без них зубы вышли бы чёрными силуэтами (цвета — классами и
 * переменными --tooth-*). Поэтому до рисования сами вписываем в каждую деталь рисунка её вычисленные fill, stroke и т. п.
 *
 * Safari (и Telegram на iPhone) с первого раза иногда рисует без шрифтов — там рисуем дважды, берём второй.
 */
export async function sheetPng(sheet: HTMLElement): Promise<Blob> {
  const host = document.createElement('div')
  host.className = 'sheet-capture'
  host.setAttribute('aria-hidden', 'true')
  const copy = sheet.cloneNode(true) as HTMLElement
  host.appendChild(copy)
  document.body.appendChild(host)
  try {
    inlineSvgStyles(copy)
    await document.fonts?.ready
    const options = {
      pixelRatio: 2,
      backgroundColor: '#ffffff',
      width: copy.offsetWidth,
      height: copy.offsetHeight,
    }
    let blob = await toBlob(copy, options)
    if (webkit()) blob = await toBlob(copy, options)
    if (!blob) throw new Error('Не получилось нарисовать лист')
    return blob
  } finally {
    host.remove()
  }
}

/** Что рисует SVG: цвета, обводка, пунктир, прозрачность — из CSS (классы, data-state, переменные) прямо в style детали. */
const SVG_PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-opacity', 'stroke-linejoin',
  'stroke-linecap', 'opacity', 'vector-effect', 'display', 'visibility', 'color'] as const

function inlineSvgStyles(root: HTMLElement) {
  root.querySelectorAll<SVGElement>('svg, svg *').forEach((el) => {
    const css = getComputedStyle(el)
    for (const prop of SVG_PROPS) {
      const value = css.getPropertyValue(prop)
      if (value) el.style.setProperty(prop, value)
    }
  })
}

function webkit(): boolean {
  const ua = navigator.userAgent
  return /AppleWebKit/.test(ua) && !/Chrome|Chromium|Android/.test(ua)
}
