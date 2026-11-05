import { useId, type ReactNode } from 'react'

import type { Lang } from './catalog'

/**
 * Иллюстрации презентаций — свои SVG, без фото: зуб в разрезе (эмаль, дентин, нерв, корни, десна,
 * кость) и его состояния, имплант, удаление, зуб мудрости, пустое место, молочный зуб, отбеливание.
 * Один «Зуб» с параметрами переиспользуется всеми темами: кариес по стадиям, пломба, каналы, коронка,
 * камень, десна. Стиль — как посты Instagram Tish: тёмный контур, мягкие цвета, ничего пугающего.
 */

export const INK = '#1B3A40'
const TEAL = '#0E8A80'
const ENAMEL = '#FFFFFF'
const YELLOW = '#F3DC9E'
const DENTIN = '#FCE7BF'
const PULP = '#F78FA3'
const HOT = '#E8384F'
const DEAD = '#B7A9A6'
const GUTTA = '#F29A38'
const FILL = '#BFEDE6'
const GUM = '#F6A6B5'
const GUM_RED = '#EE6A80'
const BONE = '#F2E1BF'
const BONE_DOT = '#E6CF9F'
const TARTAR = '#D8AE5E'
const CARIES = '#7A4A2A'
const CARIES_LIGHT = '#C99459'

/** Контур зуба (моляр в разрезе): два бугра с бороздкой посередине, шейка у y≈166, два корня. */
const OUTER = 'M58,84 C56,50 74,34 92,42 C104,48 112,58 120,62 C128,58 136,48 148,42 C166,34 184,50 182,84 C181,110 178,140 174,168 C172,180 170,190 168,200 L160,284 C158,300 140,300 140,284 L132,214 C130,202 110,202 108,214 L100,284 C98,300 80,300 80,284 L72,200 C70,190 68,180 66,168 C62,140 59,110 58,84 Z'
/** Дентин коронки — внутри эмали; ниже шейки корень и так цвета дентина. */
const INNER = 'M72,92 C72,66 84,58 96,64 C106,68 112,76 120,80 C128,76 134,68 144,64 C156,58 168,66 168,92 C167,120 164,150 160,178 L80,178 C76,150 73,120 72,92 Z'
const CHAMBER = 'M98,112 C98,98 110,98 114,106 L120,112 L126,106 C130,98 142,98 142,112 L140,170 C139,184 132,194 120,194 C108,194 101,184 100,170 Z'
const CANALS = 'M110,188 Q96,232 91,282 M130,188 Q144,232 149,282'
/** Колпачок коронки — коронковая часть контура; культя — обточенный под неё зуб. */
const CAP = 'M58,84 C56,50 74,34 92,42 C104,48 112,58 120,62 C128,58 136,48 148,42 C166,34 184,50 182,84 C181,110 178,140 175,166 L65,166 C62,140 59,110 58,84 Z'
const STUMP = 'M84,98 C86,84 100,80 120,80 C140,80 154,84 156,98 L162,168 L78,168 Z'
const CARIES_PATH = [
  '',
  'M110,63 Q124,55 138,63 Q124,75 110,63 Z',
  'M113,62 Q124,56 134,63 L127,84 Q121,87 118,82 Z',
  'M111,62 Q124,55 136,63 C146,80 143,99 128,101 C113,101 105,84 111,62 Z',
  'M109,62 Q124,53 137,63 C152,84 147,110 128,113 C110,113 99,90 109,62 Z',
]
const FILLING_PATH = {
  small: 'M113,62 Q124,56 134,63 L128,86 Q121,89 118,84 Z',
  big: 'M110,62 Q124,55 137,63 C148,82 144,100 128,102 C112,102 103,84 110,62 Z',
  inlay: 'M104,54 Q120,68 138,52 C150,42 166,46 172,62 C174,74 172,86 168,98 L114,102 C104,96 100,80 104,54 Z',
}

export type Labels = Partial<Record<'enamel' | 'dentin' | 'pulp' | 'root' | 'gum' | 'bone' | 'tartar' | 'filling' | 'crown' | 'sealant' | 'caries', boolean>>

const LABEL_TEXT: Record<keyof Labels, Record<Lang, string>> = {
  enamel: { ru: 'Эмаль', ky: 'Эмаль' },
  dentin: { ru: 'Дентин', ky: 'Дентин' },
  pulp: { ru: 'Нерв (пульпа)', ky: 'Нерв (пульпа)' },
  root: { ru: 'Корень', ky: 'Тамыр' },
  gum: { ru: 'Десна', ky: 'Бүйлө' },
  bone: { ru: 'Кость', ky: 'Сөөк' },
  tartar: { ru: 'Камень', ky: 'Таш' },
  filling: { ru: 'Пломба', ky: 'Пломба' },
  crown: { ru: 'Коронка', ky: 'Коронка' },
  sealant: { ru: 'Герметик', ky: 'Герметик' },
  caries: { ru: 'Кариес', ky: 'Кариес' },
}

/** Точка на рисунке, к которой ведёт подпись, и высота подписи справа. */
const LABEL_AT: Record<keyof Labels, [number, number, number]> = {
  caries: [124, 74, 36],
  sealant: [124, 62, 36],
  filling: [130, 80, 36],
  enamel: [178, 112, 84],
  crown: [180, 96, 96],
  dentin: [158, 140, 128],
  pulp: [128, 160, 172],
  tartar: [178, 150, 150],
  gum: [204, 178, 200],
  root: [158, 250, 246],
  bone: [206, 280, 290],
}

function LabelLines({ labels, lang, x0 = 250 }: { labels: Labels; lang: Lang; x0?: number }) {
  const keys = (Object.keys(LABEL_AT) as (keyof Labels)[]).filter((k) => labels[k])
  return (
    <g fontFamily="'Golos Text', sans-serif" fontWeight={600} fontSize={19} fill={INK}>
      {keys.map((k) => {
        const [x, y, ty] = LABEL_AT[k]
        return (
          <g key={k}>
            <path d={`M${x},${y} L${x0 - 12},${ty}`} stroke={INK} strokeWidth={2} strokeDasharray="4 4" fill="none" />
            <circle cx={x} cy={y} r={4.5} fill={INK} />
            <text x={x0} y={ty + 6}>{LABEL_TEXT[k][lang]}</text>
          </g>
        )
      })}
    </g>
  )
}

/** Кость с «губчатыми» точками и десна; top — верх кости, gumTop — край десны у зуба. */
function Jaw({ boneTop = 196, gum = 'ok', width = 240, gumTop }: { boneTop?: number; gum?: 'ok' | 'red' | 'low'; width?: number; gumTop?: number }) {
  const g = gumTop ?? (gum === 'low' ? 188 : 156)
  const dots: [number, number][] = []
  for (let y = boneTop + 26; y < 320; y += 30) for (let x = 14 + ((y / 30) % 2) * 15; x < width; x += 30) dots.push([x, y])
  const color = gum === 'red' ? GUM_RED : GUM
  return (
    <g>
      <rect x={0} y={boneTop} width={width} height={330 - boneTop} rx={18} fill={BONE} />
      {dots.map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r={4} fill={BONE_DOT} />)}
      <path d={`M0,${g + 26} C${width * 0.14},${g + 20} ${width * 0.22},${g + 8} ${width * 0.27},${g} L${width * 0.73},${g} C${width * 0.78},${g + 8} ${width * 0.86},${g + 20} ${width},${g + 26} L${width},${boneTop + 16} L0,${boneTop + 16} Z`}
        fill={color} />
      {gum === 'red' && (
        <g fill="#D4405A">{[[30, g + 40], [52, g + 30], [196, g + 32], [214, g + 42], [40, g + 52]].map(([x, y]) => <circle key={`${x}`} cx={x} cy={y} r={3.2} />)}</g>
      )}
    </g>
  )
}

export type ToothProps = {
  caries?: 0 | 1 | 2 | 3 | 4
  pulp?: 'ok' | 'hot' | 'dead' | 'filled'
  filling?: 'small' | 'big' | 'inlay'
  crown?: 'on' | 'float'
  crack?: 'line' | 'chip' | 'split'
  tartar?: 'plaque' | 'above' | 'below'
  gum?: 'ok' | 'red' | 'low'
  bone?: 'ok' | 'low'
  sealant?: boolean
  shade?: 'white' | 'yellow'
  abscess?: boolean
  /** Подписи частей справа — рисунок шире (viewBox 400) */
  labels?: Labels
  lang?: Lang
  /** Без кости и десны — только зуб */
  bare?: boolean
  title?: string
}

/** Зуб в разрезе с состояниями. */
export function Tooth(p: ToothProps) {
  const id = useId().replace(/:/g, '')
  const lang = p.lang ?? 'ru'
  const hasLabels = p.labels && Object.values(p.labels).some(Boolean)
  const pulp = p.pulp ?? (p.caries === 4 ? 'hot' : 'ok')
  const boneTop = p.bone === 'low' ? 236 : 196
  const gum = p.gum ?? (p.bone === 'low' ? 'low' : 'ok')
  const pulpColor = pulp === 'hot' ? HOT : pulp === 'dead' ? DEAD : pulp === 'filled' ? GUTTA : PULP
  const enamel = p.shade === 'yellow' ? YELLOW : ENAMEL
  const crowned = p.crown != null
  return (
    <svg viewBox={`0 ${p.crown === 'float' ? -40 : 0} ${hasLabels ? 410 : 240} ${p.crown === 'float' ? 360 : 320}`} role="img"
      aria-label={p.title} className="art" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <clipPath id={`${id}c`}><rect x={0} y={0} width={240} height={166} /></clipPath>
        <clipPath id={`${id}r`}><rect x={0} y={166} width={240} height={200} /></clipPath>
        <mask id={`${id}m`}>
          <rect x={0} y={-60} width={240} height={400} fill="#fff" />
          {(p.crack === 'chip' || p.crack === 'split') && <path d="M146,30 L196,30 L190,92 L166,96 L150,70 Z" fill="#000" />}
        </mask>
      </defs>
      {!p.bare && <Jaw boneTop={boneTop} gum={gum} />}
      {/* Боль — «лучи» вокруг воспалённого нерва */}
      {pulp === 'hot' && (
        <g stroke={HOT} strokeWidth={6} strokeLinecap="round" fill="none">
          <path d={hasLabels ? 'M30,96 l-14,-6 M28,128 l-16,2 M44,62 l-10,-12' : 'M30,96 l-14,-6 M28,128 l-16,2 M210,96 l14,-6 M212,128 l16,2 M44,62 l-10,-12 M196,62 l10,-12'} />
        </g>
      )}
      <g mask={`url(#${id}m)`}>
        {crowned ? (
          <>
            <path d={OUTER} fill={DENTIN} clipPath={`url(#${id}r)`} />
            <path d={STUMP} fill={DENTIN} stroke={INK} strokeWidth={4} />
          </>
        ) : (
          <>
            <path d={OUTER} fill={DENTIN} />
            <path d={OUTER} fill={enamel} clipPath={`url(#${id}c)`} />
            <path d={INNER} fill={DENTIN} />
          </>
        )}
        <path d={CHAMBER} fill={pulp === 'filled' ? FILL : pulpColor} />
        <path d={CANALS} stroke={pulpColor} strokeWidth={pulp === 'filled' ? 9 : 8} strokeLinecap="round" fill="none" />
        {pulp === 'filled' && <path d="M110,188 L110,170 M130,188 L130,170" stroke={GUTTA} strokeWidth={9} strokeLinecap="round" />}
        {pulp === 'ok' && !p.bare && <path d="M114,130 q6,10 0,22 q-6,12 2,24 M126,130 q-6,10 0,22 q6,12 -2,24" stroke="#E25D78" strokeWidth={2.5} fill="none" strokeLinecap="round" />}
        {p.caries != null && p.caries > 0 && !crowned && (
          <g>
            {p.caries >= 3 && <path d={CARIES_PATH[p.caries]} fill={CARIES_LIGHT} transform="translate(-6,-2) scale(1.05) translate(0,0)" opacity={0.6} />}
            <path d={CARIES_PATH[p.caries]} fill={p.caries === 1 ? CARIES_LIGHT : CARIES} />
          </g>
        )}
        {p.filling && !crowned && <path d={FILLING_PATH[p.filling]} fill={FILL} stroke={TEAL} strokeWidth={3.5} strokeLinejoin="round" />}
        {p.sealant && !crowned && <path d="M96,50 Q120,74 144,50 Q132,64 120,66 Q108,64 96,50 Z" fill="#6FD0C4" stroke={TEAL} strokeWidth={3} />}
        <path d={crowned ? `${OUTER}` : OUTER} fill="none" stroke={INK} strokeWidth={5} strokeLinejoin="round"
          clipPath={crowned ? `url(#${id}r)` : undefined} />
      </g>
      {(p.crack === 'line' || p.crack === 'split') && (
        <path d={p.crack === 'split' ? 'M150,70 L140,96 L148,118 L134,150 L142,176 L128,214' : 'M148,46 L140,70 L148,90 L138,116'}
          stroke={INK} strokeWidth={4.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      )}
      {p.crack === 'chip' && <path d="M178,52 L194,40 L200,64 Z" fill={enamel} stroke={INK} strokeWidth={4} transform="translate(14,-18) rotate(14 190 50)" />}
      {p.tartar && (
        <g fill={p.tartar === 'plaque' ? '#EBD24E' : TARTAR} stroke={p.tartar === 'plaque' ? 'none' : '#A9813A'} strokeWidth={2.5}
          opacity={p.tartar === 'plaque' ? 0.85 : 1}>
          <path d="M60,128 C50,134 52,150 58,160 C62,166 70,166 68,156 Z" />
          <path d="M180,128 C190,134 188,150 182,160 C178,166 170,166 172,156 Z" />
          {p.tartar === 'below' && (
            <>
              <path d="M68,168 C54,176 56,200 66,214 C74,220 80,206 76,190 Z" />
              <path d="M172,168 C186,176 184,200 174,214 C166,220 160,206 164,190 Z" />
            </>
          )}
        </g>
      )}
      {p.abscess && (
        <g>
          <circle cx={90} cy={292} r={17} fill="#F7C35A" stroke="#E0952B" strokeWidth={4} />
          <circle cx={150} cy={292} r={12} fill="#F7C35A" stroke="#E0952B" strokeWidth={4} />
        </g>
      )}
      {crowned && (
        <g transform={p.crown === 'float' ? 'translate(0,-34)' : undefined}>
          <path d={`${CAP} ${STUMP}`} fillRule="evenodd" fill="#FFFFFF" stroke={TEAL} strokeWidth={4.5} strokeLinejoin="round" />
          <path d="M80,74 C84,60 96,56 104,60" stroke="#D9F3F0" strokeWidth={8} fill="none" strokeLinecap="round" />
        </g>
      )}
      {p.crown === 'float' && <path d="M206,-10 L206,40 M196,28 L206,42 L216,28" stroke={TEAL} strokeWidth={5} fill="none" strokeLinecap="round" strokeLinejoin="round" />}
      {hasLabels && <LabelLines labels={p.labels!} lang={lang} />}
    </svg>
  )
}

/** Имплант: винт-корень в кости, опора (абатмент), коронка; exploded — части разведены и подписаны. */
export function Implant({ stage = 'full', labels, lang = 'ru', title }: { stage?: 'screw' | 'abutment' | 'full' | 'exploded'; labels?: boolean; lang?: Lang; title?: string }) {
  const id = useId().replace(/:/g, '')
  const exploded = stage === 'exploded'
  const top = exploded ? -90 : 0
  const names = {
    crown: { ru: 'Коронка', ky: 'Коронка' },
    abutment: { ru: 'Опора (абатмент)', ky: 'Таяныч (абатмент)' },
    screw: { ru: 'Имплант — новый корень', ky: 'Имплант — жаңы тамыр' },
    bone: { ru: 'Кость', ky: 'Сөөк' },
  }
  const showAbutment = stage !== 'screw'
  const showCrown = stage === 'full' || exploded
  return (
    <svg viewBox={`0 ${top} ${labels ? 500 : 240} ${320 - top}`} role="img" aria-label={title} className="art" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id={`${id}t`} x1="0" x2="1">
          <stop offset="0" stopColor="#D5DEE4" /><stop offset="0.5" stopColor="#F2F6F8" /><stop offset="1" stopColor="#A9B7C1" />
        </linearGradient>
      </defs>
      <Jaw gum="ok" gumTop={stage === 'screw' ? 150 : 156} />
      {/* Винт: конус с резьбой */}
      <path d="M100,186 L140,186 L136,286 Q120,304 104,286 Z" fill={`url(#${id}t)`} stroke={INK} strokeWidth={4.5} strokeLinejoin="round" />
      {[200, 216, 232, 248, 264, 278].map((y, i) => (
        <path key={y} d={`M${98 + i * 0.6},${y} L${142 - i * 0.6},${y - 8}`} stroke={INK} strokeWidth={3.5} strokeLinecap="round" />
      ))}
      {stage === 'screw' && <path d="M60,160 C90,148 150,148 180,160" stroke="#E7899C" strokeWidth={4} fill="none" strokeLinecap="round" />}
      {showAbutment && (
        <g transform={exploded ? 'translate(0,-44)' : undefined}>
          <path d="M106,186 L110,138 Q120,130 130,138 L134,186 Z" fill={`url(#${id}t)`} stroke={INK} strokeWidth={4.5} strokeLinejoin="round" />
        </g>
      )}
      {showCrown && (
        <g transform={exploded ? 'translate(0,-110)' : 'translate(0,-6)'}>
          <path d={`${CAP}`} fill="#FFFFFF" stroke={INK} strokeWidth={5} strokeLinejoin="round" />
          <path d="M80,74 C84,60 96,56 104,60" stroke="#D9F3F0" strokeWidth={8} fill="none" strokeLinecap="round" />
        </g>
      )}
      {labels && (
        <g fontFamily="'Golos Text', sans-serif" fontWeight={600} fontSize={19} fill={INK}>
          {([
            ['crown', exploded ? -30 : 90, exploded ? -30 : 90],
            ['abutment', exploded ? 115 : 160, exploded ? 115 : 160],
            ['screw', 240, 236],
            ['bone', 300, 300],
          ] as [keyof typeof names, number, number][]).filter(([k]) => (k !== 'crown' || showCrown) && (k !== 'abutment' || showAbutment)).map(([k, y, ty]) => (
            <g key={k}>
              <path d={`M${k === 'bone' ? 214 : 160},${y} L238,${ty}`} stroke={INK} strokeWidth={2} strokeDasharray="4 4" />
              <circle cx={k === 'bone' ? 214 : 160} cy={y} r={4.5} fill={INK} />
              <text x={248} y={ty + 6}>{names[k][lang]}</text>
            </g>
          ))}
        </g>
      )}
    </svg>
  )
}

/** Маленький зуб (тот же контур) для сцен из нескольких зубов. */
function Mini({ x, y, s = 0.5, rotate = 0, fill = ENAMEL, flip = false, caries = false }: { x: number; y: number; s?: number; rotate?: number; fill?: string; flip?: boolean; caries?: boolean }) {
  return (
    <g transform={`translate(${x},${y}) rotate(${rotate}) scale(${s}) ${flip ? 'scale(1,-1)' : ''} translate(-120,-170)`}>
      <path d={OUTER} fill={fill} stroke={INK} strokeWidth={5 / s * 0.5} strokeLinejoin="round" />
      {caries && <path d="M164,84 C192,90 190,132 174,140 C158,130 156,100 164,84 Z" fill={CARIES} />}
    </g>
  )
}

/** Удаление: зуб выходит из лунки → сгусток в лунке → зажило. */
export function Extraction({ state = 'clot', title }: { state?: 'out' | 'clot' | 'healed'; title?: string }) {
  return (
    <svg viewBox="0 -60 240 380" role="img" aria-label={title} className="art" xmlns="http://www.w3.org/2000/svg">
      <Jaw gumTop={state === 'healed' ? 150 : 162} />
      {state !== 'healed' && (
        <g clipPath="none">
          <path d="M74,168 L82,280 C84,296 98,296 100,282 L108,214 C110,204 130,204 132,214 L140,282 C142,296 156,296 158,280 L166,168 Z"
            fill={state === 'clot' ? '#E57F90' : '#B4566A'} />
          {state === 'clot' && <path d="M84,186 q36,-14 72,0" stroke="#F6B3BE" strokeWidth={5} fill="none" strokeLinecap="round" />}
        </g>
      )}
      {state === 'healed' && <path d="M70,160 C100,150 140,150 170,160" stroke="#E7899C" strokeWidth={4} fill="none" strokeLinecap="round" />}
      {state === 'out' && (
        <g>
          <Mini x={120} y={30} s={0.62} rotate={-10} />
          <path d="M60,40 l-16,0 M64,70 l-18,6 M180,40 l16,0 M176,70 l18,6" stroke={TEAL} strokeWidth={5} strokeLinecap="round" />
        </g>
      )}
      {state === 'clot' && <rect x={84} y={138} width={72} height={40} rx={16} fill="#FFFFFF" stroke={INK} strokeWidth={4} />}
    </svg>
  )
}

/** Зуб мудрости: растёт под углом и давит на соседа; наполовину под десной; портит соседний зуб. */
export function Wisdom({ state = 'tilt', title }: { state?: 'tilt' | 'half' | 'decay'; title?: string }) {
  return (
    <svg viewBox="0 0 320 260" role="img" aria-label={title} className="art" xmlns="http://www.w3.org/2000/svg">
      <rect x={0} y={130} width={320} height={140} rx={18} fill={BONE} />
      {[[30, 170], [70, 200], [250, 230], [290, 180], [40, 236], [140, 240]].map(([x, y]) => <circle key={`${x}${y}`} cx={x} cy={y} r={4} fill={BONE_DOT} />)}
      <path d={`M0,120 C40,112 70,100 80,96 L150,96 C170,104 200,${state === 'half' ? 96 : 110} 320,${state === 'half' ? 100 : 118} L320,150 L0,150 Z`}
        fill={state === 'half' ? GUM_RED : GUM} />
      <Mini x={110} y={130} s={0.62} caries={state === 'decay'} />
      <Mini x={232} y={state === 'half' ? 150 : 158} s={0.6} rotate={-38} />
      {state === 'tilt' && <path d="M168,92 l12,-12 l4,14 l14,-4 l-8,14 l12,8 l-16,2" stroke={HOT} strokeWidth={4} fill="none" strokeLinejoin="round" />}
      {state === 'half' && <g fill="#C98A3B">{[[196, 88], [206, 80], [214, 92]].map(([x, y]) => <circle key={x} cx={x} cy={y} r={5} />)}</g>}
    </svg>
  )
}

/** Пустое место после потери зуба: кость убывает, соседи наклоняются, зуб сверху опускается. */
export function Gap({ stage = 1, title }: { stage?: 0 | 1 | 2 | 3; title?: string }) {
  const dip = stage >= 1 ? 30 : 0
  const tilt = stage >= 2 ? 14 : 0
  return (
    <svg viewBox="0 0 320 300" role="img" aria-label={title} className="art" xmlns="http://www.w3.org/2000/svg">
      {stage >= 3 && (
        <g>
          <rect x={0} y={-20} width={320} height={50} rx={14} fill={BONE} />
          <Mini x={60} y={62} s={0.42} flip />
          <Mini x={160} y={84} s={0.42} flip />
          <Mini x={260} y={62} s={0.42} flip />
          <path d="M160,128 l0,22 M150,140 l10,12 l10,-12" stroke={HOT} strokeWidth={4.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      )}
      <path d={`M0,190 L110,190 C130,${190 + dip} 190,${190 + dip} 210,190 L320,190 L320,310 L0,310 Z`} fill={BONE} />
      {[[30, 240], [80, 270], [240, 250], [290, 280], [160, 280]].map(([x, y]) => <circle key={`${x}${y}`} cx={x} cy={y} r={4} fill={BONE_DOT} />)}
      <path d={`M0,176 L100,170 C130,${178 + dip / 2} 190,${178 + dip / 2} 220,170 L320,176 L320,200 L0,200 Z`} fill={GUM} />
      <Mini x={64} y={206} s={0.46} rotate={tilt} />
      <Mini x={256} y={206} s={0.46} rotate={-tilt} />
      {stage >= 1 && <path d="M136,236 l24,14 l24,-14" stroke={HOT} strokeWidth={4.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  )
}

/** Молочный зуб и постоянный под ним: здоров, кариес, до нерва, удалён рано — постоянный растёт криво. */
export function Kids({ state = 'ok', title }: { state?: 'ok' | 'caries' | 'deep' | 'lost'; title?: string }) {
  const id = useId().replace(/:/g, '')
  return (
    <svg viewBox="0 0 240 320" role="img" aria-label={title} className="art" xmlns="http://www.w3.org/2000/svg">
      <defs><clipPath id={`${id}c`}><rect x={0} y={0} width={240} height={166} /></clipPath></defs>
      <Jaw boneTop={150} gumTop={120} />
      {/* Зачаток постоянного зуба в кости */}
      <g transform={state === 'lost' ? 'translate(120,250) rotate(-24) scale(0.55) translate(-120,-110)' : 'translate(120,254) scale(0.55) translate(-120,-110)'}>
        <path d={CAP} fill={ENAMEL} stroke={INK} strokeWidth={7} strokeLinejoin="round" />
        <path d="M70,166 Q120,186 170,166" stroke={INK} strokeWidth={6} fill="none" strokeDasharray="10 10" />
      </g>
      {/* Молочный зуб — тот же разрез, меньше */}
      {state !== 'lost' && (
        <g transform="translate(120,96) scale(0.5) translate(-120,-120)">
          <path d={OUTER} fill={DENTIN} />
          <path d={OUTER} fill={ENAMEL} clipPath={`url(#${id}c)`} />
          <path d={INNER} fill={DENTIN} />
          <path d={CHAMBER} fill={state === 'deep' ? HOT : PULP} />
          <path d={CANALS} stroke={state === 'deep' ? HOT : PULP} strokeWidth={8} strokeLinecap="round" fill="none" />
          {state === 'caries' && <path d={CARIES_PATH[3]} fill={CARIES} />}
          {state === 'deep' && <path d={CARIES_PATH[4]} fill={CARIES} />}
          <path d={OUTER} fill="none" stroke={INK} strokeWidth={9} strokeLinejoin="round" />
        </g>
      )}
      {state === 'deep' && <path d="M50,70 l-14,-6 M48,100 l-16,2 M190,70 l14,-6 M192,100 l16,2" stroke={HOT} strokeWidth={5} strokeLinecap="round" />}
      {state === 'lost' && <path d="M90,126 C110,118 130,118 150,126" stroke="#E7899C" strokeWidth={4} fill="none" strokeLinecap="round" />}
    </svg>
  )
}

/** Отбеливание: передний зуб «было → стало» с искрами. */
export function Whiten({ title }: { title?: string }) {
  // Передний зуб спереди: ровный режущий край сверху, к десне сужается
  const incisor = 'M2,8 C2,2 8,0 14,0 L56,0 C62,0 68,2 68,8 L64,70 C62,96 54,124 35,124 C16,124 8,96 6,70 Z'
  return (
    <svg viewBox="0 0 320 220" role="img" aria-label={title} className="art" xmlns="http://www.w3.org/2000/svg">
      <rect x={0} y={150} width={320} height={70} rx={20} fill={GUM} />
      <g transform="translate(46,30)"><path d={incisor} fill={YELLOW} stroke={INK} strokeWidth={5} /></g>
      <path d="M136,96 L176,96 M164,84 L178,96 L164,108" stroke={TEAL} strokeWidth={6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <g transform="translate(204,30)"><path d={incisor} fill="#FFFFFF" stroke={INK} strokeWidth={5} />
        <path d="M14,24 C16,16 24,12 32,14" stroke="#D9F3F0" strokeWidth={8} fill="none" strokeLinecap="round" /></g>
      <Sparkle x={282} y={34} s={1} />
      <Sparkle x={196} y={20} s={0.7} />
      <Sparkle x={290} y={120} s={0.6} />
    </svg>
  )
}

export function Sparkle({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return <path transform={`translate(${x},${y}) scale(${s})`} d="M0,-18 C3,-4 4,-3 18,0 C4,3 3,4 0,18 C-3,4 -4,3 -18,0 C-4,-3 -3,-4 0,-18 Z" fill="#FFC531" stroke={INK} strokeWidth={2.5} />
}

/**
 * Тишка — маскот Tish (весёлый зуб; основа — scripts/content/tishka.mjs): позы wave и brush,
 * настроения happy и wink. Для слайдов «Больно ли?» и «Уход после».
 */
export function Tishka({ pose = 'wave', mood = 'happy', title }: { pose?: 'wave' | 'brush' | 'heart'; mood?: 'happy' | 'wink'; title?: string }) {
  const arm = (x1: number, y1: number, x2: number, y2: number) => (
    <g>
      <path d={`M${x1},${y1} Q${(x1 + x2) / 2 + (x2 > x1 ? 10 : -10)},${(y1 + y2) / 2 + 18} ${x2},${y2}`} stroke={INK} strokeWidth={13} fill="none" strokeLinecap="round" />
      <circle cx={x2} cy={y2} r={17} fill="#fff" stroke={INK} strokeWidth={7} />
    </g>
  )
  return (
    <svg viewBox="-40 0 400 380" role="img" aria-label={title} className="art tishka" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx={150} cy={362} rx={110} ry={14} fill="rgba(15,42,48,.14)" />
      {arm(68, 190, 30, 250)}
      <path d="M118,322 q-4,22 -30,26 q-6,-14 8,-24 Z M182,322 q4,22 30,26 q6,-14 -8,-24 Z" fill={TEAL} stroke={INK} strokeWidth={6} strokeLinejoin="round" />
      <path d="M60,110 C60,38 122,28 150,56 C178,28 240,38 240,110 C240,170 226,200 216,250 C206,300 196,332 180,332 C162,332 162,282 150,272 C138,282 138,332 120,332 C104,332 94,300 84,250 C74,200 60,170 60,110 Z"
        fill="#FFFFFF" stroke={INK} strokeWidth={8} strokeLinejoin="round" />
      <path d="M84,96 C84,66 104,56 122,64" stroke="#D9F3F0" strokeWidth={14} fill="none" strokeLinecap="round" />
      <path d="M78,214 C110,232 190,232 222,214 L218,240 C186,256 114,256 82,240 Z" fill={TEAL} stroke={INK} strokeWidth={6} strokeLinejoin="round" />
      <path d="M196,236 l26,34 l-22,6 Z" fill="#12A595" stroke={INK} strokeWidth={6} strokeLinejoin="round" />
      <ellipse cx={122} cy={150} rx={17} ry={22} fill={INK} />
      <circle cx={128} cy={141} r={6} fill="#fff" />
      {mood === 'wink'
        ? <path d="M165,152 Q180,140 195,152" stroke={INK} strokeWidth={8} fill="none" strokeLinecap="round" />
        : <><ellipse cx={180} cy={150} rx={17} ry={22} fill={INK} /><circle cx={186} cy={141} r={6} fill="#fff" /></>}
      <circle cx={98} cy={182} r={14} fill="#FF9DB0" opacity={0.8} />
      <circle cx={204} cy={182} r={14} fill="#FF9DB0" opacity={0.8} />
      <path d="M130,182 Q151,206 172,182 Q151,196 130,182 Z" fill="#E9475F" stroke={INK} strokeWidth={6} strokeLinejoin="round" />
      {arm(232, 180, 300, 92)}
      {pose === 'brush' && (
        <g transform="translate(300,92) rotate(-28)">
          <rect x={-12} y={-6} width={24} height={120} rx={12} fill="#FF6B8A" stroke={INK} strokeWidth={7} />
          <rect x={-16} y={-62} width={32} height={56} rx={10} fill="#fff" stroke={INK} strokeWidth={7} />
          <path d="M-8,-62 v-22 M0,-62 v-24 M8,-62 v-22" stroke="#7FD3F7" strokeWidth={7} strokeLinecap="round" />
        </g>
      )}
      {pose === 'heart' && <path transform="translate(300,60) rotate(-10)" d="M0,30 C-60,-10 -40,-60 0,-34 C40,-60 60,-10 0,30 Z" fill="#FF5A7A" stroke={INK} strokeWidth={7} />}
    </svg>
  )
}

/** Иллюстрация слайда: готовый элемент или ничего. */
export type Art = ReactNode
