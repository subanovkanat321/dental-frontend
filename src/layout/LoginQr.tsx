import { useEffect, useState } from 'react'

import { Spinner } from './Loading'

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

/**
 * QR-код ссылки в бота (та же t.me/…?start=…, что у кнопки) — для компьютера без Telegram: телефоном навели камеру,
 * в боте «Подтвердить вход», а компьютер, который опрашивает статус по своей cookie, входит сам.
 * <p>
 * Библиотеку QR (uqr, без зависимостей) грузим лениво — отдельным кусочком только там, где код показывают; в основной
 * бандл и на телефон она не попадает. Клетки всегда тёмные на белой подложке (камеры хуже читают светлый код на
 * тёмном), а рамка вокруг — по теме.
 *
 * @param link ссылка в бота; null — ещё берём (busy) или кода нет (истёк, отменён) — тогда «Обновить код»
 * @param caption подпись под кодом — что делать телефоном
 */
export function LoginQr({ link, busy = false, onRefresh, caption }: {
  link: string | null; busy?: boolean; onRefresh: () => void; caption: React.ReactNode
}) {
  const [qr, setQr] = useState<{ link: string; size: number; path: string } | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!link) return
    let alive = true
    import('uqr')
      .then(({ encode }) => {
        if (!alive) return
        const { data, size } = encode(link, { ecc: 'M', border: 0 })
        setQr({ link, size, path: qrPath(data) })
      })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [link])

  const ready = link && qr?.link === link ? qr : null
  return (
    <div className="login-qr">
      <div className="login-qr-plate">
        {ready ? (
          // Отступ в 2 клетки вокруг — «тихая зона» для камеры; она и есть белая подложка
          <svg role="img" aria-label="QR-код входа: откройте камерой телефона" data-link={ready.link}
            viewBox={`-2 -2 ${ready.size + 4} ${ready.size + 4}`} shapeRendering="crispEdges">
            <rect x={-2} y={-2} width={ready.size + 4} height={ready.size + 4} fill="#fff" />
            <path d={ready.path} fill="#0F2A30" />
          </svg>
        ) : (
          <div className="login-qr-empty">
            {link || busy ? (failed ? <span>Код не открылся</span> : <Spinner />) : <span>Код устарел</span>}
          </div>
        )}
      </div>
      <p className="hint small">{caption}</p>
      <button type="button" className="link" disabled={busy} onClick={onRefresh}>
        {busy ? 'Обновляем…' : 'Обновить код'}</button>
    </div>
  )
}
