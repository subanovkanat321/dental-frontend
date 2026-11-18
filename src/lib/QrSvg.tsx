import type { Qr } from './qr'

/** Картинка кода; отступ в 2 клетки вокруг — «тихая зона» для камеры, она и есть белая подложка. */
export function QrSvg({ qr, label }: { qr: Qr; label: string }) {
  return (
    <svg role="img" aria-label={label} data-link={qr.text} viewBox={`-2 -2 ${qr.size + 4} ${qr.size + 4}`} shapeRendering="crispEdges">
      <rect x={-2} y={-2} width={qr.size + 4} height={qr.size + 4} fill="#fff" />
      <path d={qr.path} fill="#0F2A30" />
    </svg>
  )
}
