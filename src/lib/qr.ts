import { useEffect, useState } from 'react'

/** Тёмные клетки QR одной SVG-линией: соседние клетки строки — одним прямоугольником (меньше разметки). */
function qrPath(data: boolean[][]): string {
  let d = ''
  data.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (!row[x]) continue
      let w = 1
      while (row[x + w]) w++
      d += `M${x} ${y}h${w}v1h-${w}z`
      x += w - 1
    }
  })
  return d
}

export type Qr = { text: string; size: number; path: string }

/**
 * QR-код текста (ссылки). Библиотеку QR (uqr, без зависимостей) грузим лениво — отдельным кусочком только там, где код
 * показывают; в основной бандл и на телефон она не попадает.
 *
 * @returns код, когда готов; null — ещё грузим; 'error' — библиотека не загрузилась
 */
export function useQr(text: string | null): Qr | null | 'error' {
  const [qr, setQr] = useState<Qr | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!text) return
    let alive = true
    import('uqr')
      .then(({ encode }) => {
        if (!alive) return
        const { data, size } = encode(text, { ecc: 'M', border: 0 })
        setQr({ text, size, path: qrPath(data) })
      })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [text])
  if (failed) return 'error'
  return text && qr?.text === text ? qr : null
}

/** SVG-разметка кода: клетки всегда тёмные на белой подложке (камеры хуже читают светлый код на тёмном). */
export function qrSvg(qr: Qr): string {
  const box = qr.size + 4
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 ${box} ${box}" width="${box * 10}" height="${box * 10}" shape-rendering="crispEdges">`
    + `<rect x="-2" y="-2" width="${box}" height="${box}" fill="#fff"/><path d="${qr.path}" fill="#0F2A30"/></svg>`
}
