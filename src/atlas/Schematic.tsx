import { numberedLabels, PARTS, type Lang, type PartId } from './content'

/** Где номер части на плоской схеме (viewBox 400×480). */
const SPOTS: Partial<Record<PartId, [number, number]>> = {
  enamel: [282, 112], dentin: [252, 172], pulp: [200, 186], vessels: [262, 372], canal: [138, 372],
  cementum: [298, 318], pdl: [314, 410], bone: [344, 360], gum: [344, 244],
}

const OUTER = 'M110 200C95 160 92 110 110 80C125 55 150 62 165 72C180 60 195 58 200 70C205 58 220 60 235 72C250 62 275 55 290 80C308 110 305 160 290 200C285 260 300 330 290 420C282 432 262 430 258 418C252 340 235 280 215 262C200 255 190 257 185 262C165 280 150 340 142 418C138 430 118 432 110 420C100 330 115 260 110 200Z'
const DENTIN = 'M124 205C112 165 112 120 128 100C150 88 250 88 272 100C288 120 288 165 276 205C272 262 288 330 280 412C272 420 266 418 266 410C262 340 245 280 222 255C200 245 196 246 178 255C155 280 138 340 134 410C132 418 126 420 120 412C112 330 128 262 124 205Z'
const PULP = 'M165 150C165 135 175 135 180 145L220 145C225 135 235 135 235 150L238 215C238 225 230 228 228 238C240 300 268 350 272 418L267 419C258 350 232 300 214 250L186 250C168 300 142 350 133 419L128 418C132 350 160 300 172 238C170 228 162 225 162 215Z'

/**
 * Запасной вариант без WebGL: плоская схема зуба в разрезе с теми же номерами, что у 3D-модели.
 * Рисунок — SVG прямо в коде: ничего не грузится, работает на любом устройстве.
 */
export function Schematic({ lang, part, onPart }: { lang: Lang; part: PartId | null; onPart: (p: PartId) => void }) {
  const labels = numberedLabels('healthy')
  return (
    <svg className="atlas-schematic" viewBox="0 0 400 480" role="img" aria-label={lang === 'ru' ? 'Схема зуба в разрезе' : 'Тиштин кесилишинин схемасы'}>
      <defs>
        <pattern id="atlas-spongy" width="18" height="18" patternUnits="userSpaceOnUse">
          <rect width="18" height="18" fill="#ead9b8" />
          <ellipse cx="5" cy="6" rx="3.5" ry="2.5" fill="#d6a48f" />
          <ellipse cx="13" cy="13" rx="3" ry="4" fill="#c98f7f" />
        </pattern>
        <clipPath id="atlas-crown"><rect x="0" y="0" width="400" height="204" /></clipPath>
        <clipPath id="atlas-bone"><rect x="0" y="250" width="400" height="230" /></clipPath>
      </defs>
      <rect x="20" y="246" width="360" height="222" rx="10" fill="url(#atlas-spongy)" stroke="#ebe1cc" strokeWidth="8" />
      <path d={OUTER} fill="none" stroke="#d0716f" strokeWidth="14" clipPath="url(#atlas-bone)" />
      <path d="M20 236C60 226 92 214 112 206L112 262L288 262L290 206C310 214 340 226 380 236L380 262L20 262Z" fill="#e07f86" />
      <path d={OUTER} fill="#d4ad62" />
      <path d={OUTER} fill="#f3efe6" clipPath="url(#atlas-crown)" />
      <path d={DENTIN} fill="#e7c98e" />
      <path d={PULP} fill="#c43d3f" />
      <path d="M200 470C205 420 262 400 268 418M200 470C200 420 138 400 131 418" fill="none" stroke="#e0262b" strokeWidth="3" />
      {labels.map((l) => {
        const at = SPOTS[l.part]
        if (!at) return null
        return (
          <g key={l.part} className={part === l.part ? 'atlas-svg-dot active' : 'atlas-svg-dot'} onClick={() => onPart(l.part)} role="button" aria-label={`${l.n}. ${PARTS[l.part][lang].name}`}>
            <circle cx={at[0]} cy={at[1]} r="13" />
            <text x={at[0]} y={at[1] + 5} textAnchor="middle">{l.n}</text>
          </g>
        )
      })}
    </svg>
  )
}
