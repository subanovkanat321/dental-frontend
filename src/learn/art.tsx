import { useId, type ReactNode } from 'react'

import type { Lang } from './catalog'

/**
 * Иллюстрации презентаций — свои SVG в стиле медицинского атласа: зуб в разрезе с объёмом (эмаль,
 * дентин, пульпа с сосудами, корни, связка, губчатая кость, десна), его состояния, имплант с
 * резьбой, коронка, удаление, зуб мудрости, пустое место, молочный зуб, отбеливание. Тонкий контур,
 * градиенты вместо заливки одним цветом, подписи — тонкими выносками справа. Без лиц и «мультяшности»,
 * без крови: воспаление — цветом ткани, не каплями.
 *
 * Один «Зуб» с параметрами переиспользуется всеми темами (стадии кариеса, пломба, каналы, коронка,
 * камень, десна). Градиенты и узор кости — в <Kit> каждого рисунка: id уникальны (useId), рисунков
 * на слайде стадий четыре.
 */

export const LINE = '#3D4F55'
const LEADER = '#5E7379'
const TEXT = '#0F2A30'
const TEAL = '#0E8A80'
const ARROW = '#B4441F'

/** Контур зуба (моляр в разрезе): два бугра с бороздкой посередине, шейка у y≈166, два корня. */
const OUTER = 'M58,84 C56,50 74,34 92,42 C104,48 112,58 120,62 C128,58 136,48 148,42 C166,34 184,50 182,84 C181,110 178,140 174,168 C172,180 170,190 168,200 L160,284 C158,300 140,300 140,284 L132,214 C130,202 110,202 108,214 L100,284 C98,300 80,300 80,284 L72,200 C70,190 68,180 66,168 C62,140 59,110 58,84 Z'
/** Дентин коронки — внутри эмали; ниже шейки корень и так цвета дентина. */
const INNER = 'M72,92 C72,66 84,58 96,64 C106,68 112,76 120,80 C128,76 134,68 144,64 C156,58 168,66 168,92 C167,120 164,150 160,178 L80,178 C76,150 73,120 72,92 Z'
const CHAMBER = 'M98,112 C98,98 110,98 114,106 L120,112 L126,106 C130,98 142,98 142,112 L140,170 C139,184 132,194 120,194 C108,194 101,184 100,170 Z'
const CANALS = 'M110,188 Q96,232 91,282 M130,188 Q144,232 149,282'
/** Сосуды и нерв в пульпе — тонкие линии */
const VESSELS = 'M112,124 C108,146 116,164 108,188 Q100,226 93,276 M128,124 C132,146 124,164 132,188 Q140,226 147,276'
/** Колпачок коронки — коронковая часть контура; культя — обточенный под неё зуб. */
const CAP = 'M58,84 C56,50 74,34 92,42 C104,48 112,58 120,62 C128,58 136,48 148,42 C166,34 184,50 182,84 C181,110 178,140 175,166 L65,166 C62,140 59,110 58,84 Z'
const STUMP = 'M84,98 C86,84 100,80 120,80 C140,80 154,84 156,98 L162,168 L78,168 Z'
const CARIES_PATH = [
  '',
  'M110,63 Q124,55 138,63 Q124,73 110,63 Z',
  'M113,62 Q124,56 134,63 L127,84 Q121,87 118,82 Z',
  'M111,62 Q124,55 136,63 C146,80 143,99 128,101 C113,101 105,84 111,62 Z',
  'M109,62 Q124,53 137,63 C152,84 147,110 128,113 C110,113 99,90 109,62 Z',
]
/** Тёмное пятно в дентине вокруг полости — кариес идёт шире, чем видно снаружи */
const CARIES_HALO = [
  '', '',
  'M110,64 Q124,58 137,64 L132,90 Q121,96 114,88 Z',
  'M104,64 Q124,52 142,64 C156,86 152,110 128,112 C106,112 96,90 104,64 Z',
  'M102,64 Q124,50 144,64 C160,90 154,120 128,122 C104,122 92,96 102,64 Z',
]
const FILLING_PATH = {
  small: 'M113,62 Q124,56 134,63 L128,86 Q121,89 118,84 Z',
  big: 'M110,62 Q124,55 137,63 C148,82 144,100 128,102 C112,102 103,84 110,62 Z',
  inlay: 'M104,54 Q120,68 138,52 C150,42 166,46 172,62 C174,74 172,86 168,98 L114,102 C104,96 100,80 104,54 Z',
}

/** Градиенты, узор кости и размытия одного рисунка; u('enamel') → url(#…-enamel). */
function useKit() {
  const p = `k${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  return { p, u: (name: string) => `url(#${p}-${name})` }
}

function Kit({ p }: { p: string }) {
  const v = (id: string, stops: [number, string, number?][], h = false) => (
    <linearGradient id={`${p}-${id}`} x1="0" y1="0" x2={h ? 1 : 0} y2={h ? 0 : 1}>
      {stops.map(([o, c, a]) => <stop key={o} offset={o} stopColor={c} stopOpacity={a ?? 1} />)}
    </linearGradient>
  )
  const r = (id: string, stops: [number, string, number?][]) => (
    <radialGradient id={`${p}-${id}`} cx="0.5" cy="0.45" r="0.6">
      {stops.map(([o, c, a]) => <stop key={o} offset={o} stopColor={c} stopOpacity={a ?? 1} />)}
    </radialGradient>
  )
  return (
    <defs>
      {v('enamel', [[0, '#FFFFFF'], [0.55, '#F2F5F4'], [1, '#DCE3E2']])}
      {v('enamelY', [[0, '#FAF0D2'], [0.6, '#EFDDAE'], [1, '#E2C88E']])}
      {v('dentin', [[0, '#F8EACF'], [1, '#EDD5A6']])}
      {v('root', [[0, '#F3E1BC'], [1, '#E2C690']])}
      {r('pulp', [[0, '#F6AAB0'], [1, '#D97483']])}
      {r('pulpHot', [[0, '#F0646A'], [1, '#B42F3E']])}
      {r('pulpDead', [[0, '#C5B8B1'], [1, '#8E807A']])}
      {v('gp', [[0, '#F2A274'], [1, '#D46F3D']])}
      {v('material', [[0, '#EAF5F3'], [1, '#C6E2DE']])}
      {v('gum', [[0, '#F6BDC2'], [0.5, '#EDA1AA'], [1, '#E3909A']])}
      {v('gumRed', [[0, '#F08A92'], [0.5, '#E06573'], [1, '#C94B5C']])}
      {v('porcelain', [[0, '#FFFFFF'], [0.6, '#F1F5F6'], [1, '#DCE5E7']])}
      {v('metal', [[0, '#66737C'], [0.22, '#C3CDD3'], [0.42, '#F5F8FA'], [0.68, '#A5B1B9'], [1, '#56626B']], true)}
      {v('shade', [[0, '#FFFFFF', 0.5], [0.32, '#FFFFFF', 0], [0.7, '#1E323C', 0], [1, '#1E323C', 0.18]], true)}
      {v('tartar', [[0, '#E3C681'], [1, '#B08646']])}
      {v('tartarDeep', [[0, '#A8865A'], [1, '#7C5E36']])}
      {v('clot', [[0, '#C99A94'], [1, '#B07F7A']])}
      {r('caries', [[0, '#3E2316'], [0.6, '#6B3F25'], [1, '#9A6A40']])}
      {r('lesion', [[0, '#B0645E', 0.75], [0.7, '#C98B76', 0.35], [1, '#D9A27F', 0]])}
      {r('glow', [[0, '#E8384F', 0.45], [1, '#E8384F', 0]])}
      <pattern id={`${p}-bone`} width={36} height={30} patternUnits="userSpaceOnUse">
        <rect width={36} height={30} fill="#EFE1C2" />
        <g fill="#F6ECD6" stroke="#E0CCA3" strokeWidth={1}>
          <path d="M3,6 q6,-6 13,-1 q3,7 -3,10 q-8,2 -10,-9 z" />
          <path d="M20,2 q9,-2 13,5 q-2,7 -9,7 q-6,-3 -4,-12 z" />
          <path d="M8,19 q8,-3 12,2 q0,7 -7,8 q-7,-2 -5,-10 z" />
          <path d="M25,17 q7,0 9,6 q-3,6 -9,5 q-4,-5 0,-11 z" />
        </g>
      </pattern>
      <filter id={`${p}-soft`} x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation={2.4} /></filter>
      <filter id={`${p}-blur`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation={7} /></filter>
    </defs>
  )
}

export type Labels = Partial<Record<'enamel' | 'dentin' | 'pulp' | 'root' | 'gum' | 'bone' | 'tartar' | 'filling' | 'crown' | 'sealant' | 'caries' | 'canals', boolean>>
type LabelKey = keyof Labels

const LABEL_TEXT: Record<LabelKey, Record<Lang, string>> = {
  caries: { ru: 'Кариес', ky: 'Кариес' },
  sealant: { ru: 'Герметик', ky: 'Герметик' },
  filling: { ru: 'Пломба', ky: 'Пломба' },
  crown: { ru: 'Коронка', ky: 'Коронка' },
  enamel: { ru: 'Эмаль', ky: 'Эмаль' },
  dentin: { ru: 'Дентин', ky: 'Дентин' },
  pulp: { ru: 'Пульпа (нерв)', ky: 'Пульпа (нерв)' },
  canals: { ru: 'Каналы', ky: 'Каналдар' },
  tartar: { ru: 'Зубной камень', ky: 'Тиш ташы' },
  gum: { ru: 'Десна', ky: 'Бүйлө' },
  root: { ru: 'Корень', ky: 'Тамыр' },
  bone: { ru: 'Кость', ky: 'Сөөк' },
}

/** Точка на рисунке, к которой ведёт выноска, и высота подписи справа. */
const LABEL_AT: Record<LabelKey, [number, number, number]> = {
  caries: [124, 72, 30],
  sealant: [122, 62, 30],
  filling: [130, 80, 30],
  crown: [176, 70, 66],
  enamel: [175, 102, 78],
  dentin: [156, 132, 122],
  pulp: [128, 150, 166],
  tartar: [182, 150, 150],
  canals: [138, 226, 210],
  gum: [206, 180, 206],
  root: [152, 252, 252],
  bone: [214, 288, 292],
}

/** Выноски как в атласе: точка на детали, тонкая линия с изломом, подпись справа. */
function Callouts({ items, x0 = 262 }: { items: [number, number, number, string][]; x0?: number }) {
  return (
    <g fontFamily="'Golos Text', sans-serif" fontWeight={500} fontSize={16} fill={TEXT}>
      {items.map(([x, y, ty, text]) => (
        <g key={text}>
          <path d={`M${x},${y} L${x0 - 26},${ty} L${x0 - 8},${ty}`} stroke={LEADER} strokeWidth={1.1} fill="none" />
          <circle cx={x} cy={y} r={3} fill="#fff" stroke={LEADER} strokeWidth={1.4} />
          <text x={x0} y={ty + 5.5}>{text}</text>
        </g>
      ))}
    </g>
  )
}

/** Кость (губчатая, с плотным краем) и десна; boneTop — верх кости, gumTop — край десны у зуба. */
function Jaw({ u, boneTop = 196, gum = 'ok', width = 240, gumTop, height = 330 }: { u: (n: string) => string; boneTop?: number; gum?: 'ok' | 'red' | 'low'; width?: number; gumTop?: number; height?: number }) {
  const g = (gumTop ?? (gum === 'low' ? 188 : 156)) - (gum === 'red' ? 4 : 0)
  const swell = gum === 'red' ? 8 : 0
  const top = `M0,${g + 28} C${width * 0.12},${g + 24 - swell} ${width * 0.2},${g + 6 - swell} ${width * 0.27},${g} L${width * 0.73},${g} C${width * 0.8},${g + 6 - swell} ${width * 0.88},${g + 24 - swell} ${width},${g + 28}`
  return (
    <g>
      <rect x={0} y={boneTop} width={width} height={height - boneTop} rx={14} fill={u('bone')} />
      <path d={`M6,${boneTop + 2} H${width - 6}`} stroke="#DCC79C" strokeWidth={4} strokeLinecap="round" />
      <path d={`${top} L${width},${boneTop + 18} L0,${boneTop + 18} Z`} fill={u(gum === 'red' ? 'gumRed' : 'gum')} />
      <path d={top} fill="none" stroke={gum === 'red' ? '#B23C4E' : '#C97C88'} strokeWidth={1.4} />
      <path d={top} fill="none" stroke="#FFFFFF" strokeOpacity={0.45} strokeWidth={3} transform="translate(0,4)" />
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
  /** Каналы открыты, в канале — эндодонтический инструмент (файл) */
  instrument?: boolean
  /** Подписи частей справа — рисунок шире (viewBox 410) */
  labels?: Labels
  lang?: Lang
  /** Без кости и десны — только зуб */
  bare?: boolean
  title?: string
}

/** Зуб в разрезе с состояниями. */
export function Tooth(p: ToothProps) {
  const { p: id, u } = useKit()
  const lang = p.lang ?? 'ru'
  const hasLabels = !!p.labels && Object.values(p.labels).some(Boolean)
  const pulp = p.pulp ?? (p.caries === 4 ? 'hot' : 'ok')
  const boneTop = p.bone === 'low' ? 236 : 196
  const gum = p.gum ?? (p.bone === 'low' ? 'low' : 'ok')
  const pulpFill = pulp === 'hot' ? u('pulpHot') : pulp === 'dead' ? u('pulpDead') : pulp === 'filled' ? u('material') : u('pulp')
  const canalColor = p.instrument ? '#E9B4B2' : pulp === 'hot' ? '#C43A48' : pulp === 'dead' ? '#9C8E88' : pulp === 'filled' ? u('gp') : '#DE8592'
  const crowned = p.crown != null
  const float = p.crown === 'float'
  const top = float ? -40 : p.instrument ? -64 : 0
  const height = (float ? 360 : 320) - (p.instrument ? top : 0)
  const caries = !crowned && !p.instrument && p.caries ? p.caries : 0
  const callouts: [number, number, number, string][] = hasLabels
    ? (Object.keys(LABEL_AT) as LabelKey[]).filter((k) => p.labels![k]).map((k) => {
      const [x, y, ty] = LABEL_AT[k]
      const shift = k === 'crown' && float ? -34 : 0
      return [x, y + shift, ty + shift, LABEL_TEXT[k][lang]]
    })
    : []
  return (
    <svg viewBox={`0 ${top} ${hasLabels ? 410 : 240} ${height}`} role="img" aria-label={p.title} className="art" xmlns="http://www.w3.org/2000/svg">
      <Kit p={id} />
      <defs>
        <clipPath id={`${id}c`}><rect x={0} y={-60} width={240} height={226} /></clipPath>
        <clipPath id={`${id}r`}><rect x={0} y={166} width={240} height={200} /></clipPath>
        <clipPath id={`${id}t`}><path d={OUTER} /></clipPath>
        <mask id={`${id}m`}>
          <rect x={0} y={-80} width={240} height={420} fill="#fff" />
          {(p.crack === 'chip' || p.crack === 'split') && <path d="M146,30 L196,30 L190,92 L172,98 L162,84 L154,70 Z" fill="#000" />}
        </mask>
      </defs>
      {!p.bare && <Jaw u={u} boneTop={boneTop} gum={gum} />}
      {/* Связка вокруг корня — тонкая тёмная щель между корнем и костью */}
      {!p.bare && <path d={OUTER} fill="none" stroke="#B89466" strokeOpacity={0.55} strokeWidth={6} clipPath={`url(#${id}r)`} />}
      {pulp === 'hot' && !p.instrument && <ellipse cx={120} cy={150} rx={62} ry={70} fill={u('glow')} />}
      <g mask={`url(#${id}m)`}>
        {crowned ? (
          <>
            <path d={OUTER} fill={u('root')} clipPath={`url(#${id}r)`} />
            <path d={STUMP} fill={u('dentin')} stroke={LINE} strokeWidth={1.4} />
          </>
        ) : (
          <>
            <path d={OUTER} fill={u('root')} />
            <path d={OUTER} fill={u(p.shade === 'yellow' ? 'enamelY' : 'enamel')} clipPath={`url(#${id}c)`} />
            <path d={INNER} fill={u('dentin')} />
            {/* Граница эмали и дентина — тонкой линией */}
            <path d={INNER} fill="none" stroke="#D8C49C" strokeWidth={1} clipPath={`url(#${id}c)`} />
          </>
        )}
        <g clipPath={`url(#${id}t)`}>
          {caries >= 2 && <path d={CARIES_HALO[caries]} fill="#B98654" opacity={0.55} filter={u('soft')} />}
        </g>
        <path d={CHAMBER} fill={pulpFill} stroke={pulp === 'filled' ? '#9FBDB8' : '#C25E6D'} strokeWidth={0.8} />
        <path d={CANALS} stroke={canalColor} strokeWidth={pulp === 'filled' ? 7.5 : 7} strokeLinecap="round" fill="none" />
        {pulp === 'filled' && <path d="M110,188 L110,172 M130,188 L130,172" stroke={u('gp')} strokeWidth={7.5} strokeLinecap="round" />}
        {(pulp === 'ok' || pulp === 'hot') && !p.instrument && (
          <path d={VESSELS} stroke={pulp === 'hot' ? '#8E1F2E' : '#B9506A'} strokeWidth={1.1} fill="none" strokeLinecap="round" opacity={0.7} />
        )}
        {p.instrument && (
          <>
            {/* Доступ к каналам: открытая полость от жевательной поверхности до камеры */}
            <path d="M104,52 L108,106 L132,106 L136,52 Q120,62 104,52 Z" fill="#EFE6D6" stroke={LINE} strokeWidth={1.2} />
            <path d={CHAMBER} fill="#F4DEDA" stroke="#C9A39C" strokeWidth={0.8} />
          </>
        )}
        {caries === 1 && <path d={CARIES_PATH[1]} fill="#C7A27B" opacity={0.85} />}
        {caries >= 2 && <path d={CARIES_PATH[caries]} fill={u('caries')} stroke="#4A2A1A" strokeWidth={0.8} />}
        {p.filling && !crowned && <path d={FILLING_PATH[p.filling]} fill={u('material')} stroke={TEAL} strokeWidth={1.6} strokeLinejoin="round" />}
        {p.sealant && !crowned && <path d="M98,52 Q120,72 142,52 Q132,64 120,66 Q108,64 98,52 Z" fill={u('material')} stroke={TEAL} strokeWidth={1.4} />}
        {/* Объём: свет слева, тень справа; блик на бугре */}
        {!crowned && <path d={OUTER} fill={u('shade')} />}
        {!crowned && <ellipse cx={84} cy={62} rx={10} ry={6} fill="#FFFFFF" opacity={0.8} filter={u('soft')} transform="rotate(-30 84 62)" />}
        <path d={OUTER} fill="none" stroke={LINE} strokeWidth={1.7} strokeLinejoin="round" clipPath={crowned ? `url(#${id}r)` : undefined} />
      </g>
      {(p.crack === 'chip' || p.crack === 'split') && <path d="M190,92 L172,98 L162,84 L154,70 L150,52" fill="none" stroke={LINE} strokeWidth={1.4} strokeLinejoin="round" />}
      {(p.crack === 'line' || p.crack === 'split') && (
        <path d={p.crack === 'split' ? 'M154,70 L146,96 L152,118 L140,150 L146,176 L134,214' : 'M148,46 L142,70 L148,90 L140,116'}
          stroke="#2A363A" strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      )}
      {p.tartar === 'plaque' && (
        <path d="M60,118 C58,136 62,152 66,166 M180,118 C182,136 178,152 174,166" stroke="#E5CB6A" strokeOpacity={0.75} strokeWidth={7} fill="none" strokeLinecap="round" />
      )}
      {(p.tartar === 'above' || p.tartar === 'below') && (
        <g fill={u('tartar')} stroke="#97733B" strokeWidth={1}>
          <path d="M61,126 C53,132 53,148 57,158 C60,166 68,166 67,156 C66,146 64,136 61,126 Z" />
          <path d="M179,126 C187,132 187,148 183,158 C180,166 172,166 173,156 C174,146 176,136 179,126 Z" />
          {p.tartar === 'below' && (
            <g fill={u('tartarDeep')} stroke="#5E4527">
              <path d="M67,168 C58,178 58,198 65,212 C70,218 76,208 74,192 Z" />
              <path d="M173,168 C182,178 182,198 175,212 C170,218 164,208 166,192 Z" />
            </g>
          )}
          <g fill="#8C6A3A" stroke="none" opacity={0.6}>
            {[[58, 140], [62, 152], [182, 140], [178, 152]].map(([x, y]) => <circle key={`${x}${y}`} cx={x} cy={y} r={1.3} />)}
          </g>
        </g>
      )}
      {p.abscess && (
        <g>
          <ellipse cx={90} cy={290} rx={24} ry={20} fill={u('lesion')} />
          <ellipse cx={150} cy={290} rx={18} ry={16} fill={u('lesion')} />
        </g>
      )}
      {p.instrument && (
        <g>
          {/* Эндодонтический файл: ручка, стержень с насечкой вдоль канала */}
          <path d="M113,-22 L111,60 L110,188 Q101,216 96,248" stroke={u('metal')} strokeWidth={4} fill="none" strokeLinecap="round" />
          <path d="M111,70 L110,188 Q101,216 96,248" stroke="#5B666E" strokeWidth={4} strokeDasharray="1.5 3" fill="none" />
          <rect x={100} y={-58} width={26} height={40} rx={5} fill="#F2C94C" stroke="#A88620" strokeWidth={1.2} />
          <path d="M104,-50 H122 M104,-44 H122 M104,-38 H122" stroke="#D3A928" strokeWidth={1.2} />
        </g>
      )}
      {crowned && (
        <g transform={float ? 'translate(0,-34)' : undefined}>
          <path d={CAP} fill={u('porcelain')} stroke={LINE} strokeWidth={1.7} strokeLinejoin="round" />
          <path d={CAP} fill={u('shade')} />
          <ellipse cx={84} cy={62} rx={10} ry={6} fill="#FFFFFF" opacity={0.9} filter={u('soft')} transform="rotate(-30 84 62)" />
          {!float && <path d="M78,168 L65,166 M162,168 L175,166" stroke={TEAL} strokeWidth={1.4} />}
        </g>
      )}
      {float && <path d="M28,-14 V36 M21,28 L28,38 L35,28" stroke={LEADER} strokeWidth={1.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />}
      {hasLabels && <Callouts items={callouts} />}
    </svg>
  )
}

/** Тело имплантата: конус с резьбой по краям (профиль витков) от y0 до y1. */
function screwPath(x: number, y0: number, y1: number, w0: number, w1: number, pitch = 11): string {
  const half = (y: number) => (w0 + (w1 - w0) * ((y - y0) / (y1 - y0))) / 2
  let left = `M${x - half(y0)},${y0}`
  let right = ''
  for (let y = y0 + 4; y < y1 - 10; y += pitch) {
    const h = half(y)
    left += ` L${x - h},${y} L${x - h - 6},${y + 3} L${x - h},${y + 7}`
    right = ` L${x + h},${y + 7} L${x + h + 6},${y + 3} L${x + h},${y}` + right
  }
  const hb = half(y1 - 10)
  return `${left} L${x - hb},${y1 - 10} Q${x},${y1 + 10} ${x + hb},${y1 - 10}${right} L${x + half(y0)},${y0} Z`
}
const SCREW = screwPath(120, 186, 292, 40, 30)
const ABUTMENT = 'M107,188 L111,134 Q120,128 129,134 L133,188 Z'

/** Имплант: винт-корень в кости, опора (абатмент), коронка; exploded — части разведены по оси и подписаны. */
export function Implant({ stage = 'full', labels, lang = 'ru', title }: { stage?: 'screw' | 'abutment' | 'full' | 'exploded'; labels?: boolean; lang?: Lang; title?: string }) {
  const { p, u } = useKit()
  const exploded = stage === 'exploded'
  const top = exploded ? -100 : 0
  const names = {
    crown: { ru: 'Коронка', ky: 'Коронка' },
    abutment: { ru: 'Опора (абатмент)', ky: 'Таяныч (абатмент)' },
    screw: { ru: 'Имплант — новый корень', ky: 'Имплант — жаңы тамыр' },
    bone: { ru: 'Кость', ky: 'Сөөк' },
  }
  const showAbutment = stage !== 'screw'
  const showCrown = stage === 'full' || exploded
  const items: [number, number, number, string][] = [
    ...(showCrown ? [[176, exploded ? -40 : 80, exploded ? -40 : 70, names.crown[lang]] as [number, number, number, string]] : []),
    ...(showAbutment ? [[130, exploded ? 116 : 160, exploded ? 116 : 150, names.abutment[lang]] as [number, number, number, string]] : []),
    [140, 236, 232, names.screw[lang]],
    [214, 296, 296, names.bone[lang]],
  ]
  return (
    <svg viewBox={`0 ${top} ${labels ? 445 : 240} ${320 - top}`} role="img" aria-label={title} className="art" xmlns="http://www.w3.org/2000/svg">
      <Kit p={p} />
      <Jaw u={u} gum="ok" gumTop={stage === 'screw' ? 150 : 158} />
      {exploded && <path d="M120,-110 V300" stroke={LEADER} strokeWidth={1} strokeDasharray="5 5" />}
      <path d={SCREW} fill={u('metal')} stroke={LINE} strokeWidth={1.4} strokeLinejoin="round" />
      {/* Витки резьбы — наклонные линии поперёк тела */}
      <g stroke="#4F5B63" strokeWidth={1} opacity={0.55}>
        {Array.from({ length: 8 }, (_, i) => 194 + i * 11).map((y) => <path key={y} d={`M${101 + (y - 186) * 0.05},${y + 3} L${139 - (y - 186) * 0.05},${y - 3}`} />)}
      </g>
      {stage === 'screw' && <path d="M84,160 C104,154 136,154 156,160" stroke="#C97C88" strokeWidth={1.4} fill="none" strokeLinecap="round" />}
      {showAbutment && (
        <g transform={exploded ? 'translate(0,-46)' : undefined}>
          <path d={ABUTMENT} fill={u('metal')} stroke={LINE} strokeWidth={1.4} strokeLinejoin="round" />
          <path d="M109,170 H131 M110,156 H130" stroke="#4F5B63" strokeWidth={1} opacity={0.5} />
        </g>
      )}
      {showCrown && (
        <g transform={exploded ? 'translate(0,-118)' : 'translate(0,-8)'}>
          <path d={CAP} fill={u('porcelain')} stroke={LINE} strokeWidth={1.7} strokeLinejoin="round" />
          <path d={CAP} fill={u('shade')} />
          <ellipse cx={84} cy={62} rx={10} ry={6} fill="#FFFFFF" opacity={0.9} filter={u('soft')} transform="rotate(-30 84 62)" />
        </g>
      )}
      {labels && <Callouts items={items} x0={262} />}
    </svg>
  )
}

/** Зуб целиком (тот же контур, с объёмом) для сцен из нескольких зубов. */
function Mini({ u, x, y, s = 0.5, rotate = 0, flip = false, caries = false, yellow = false }: { u: (n: string) => string; x: number; y: number; s?: number; rotate?: number; flip?: boolean; caries?: boolean; yellow?: boolean }) {
  return (
    <g transform={`translate(${x},${y}) rotate(${rotate}) scale(${s}) ${flip ? 'scale(1,-1)' : ''} translate(-120,-170)`}>
      <path d={OUTER} fill={u('root')} />
      <path d={CAP} fill={u(yellow ? 'enamelY' : 'enamel')} />
      {caries && <path d="M166,74 C186,82 186,126 172,134 C158,124 156,96 166,74 Z" fill={u('caries')} />}
      <path d={OUTER} fill={u('shade')} />
      <path d={OUTER} fill="none" stroke={LINE} strokeWidth={1.7 / s} strokeLinejoin="round" />
    </g>
  )
}

/** Стрелка-указатель движения (наклон, давление, убыль кости): тонкая, приглушённо-красная. */
function Move({ d }: { d: string }) {
  return <path d={d} stroke={ARROW} strokeWidth={2.2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
}

/** Удаление: зуб выходит из лунки → сгусток в лунке под тампоном → зажило. */
export function Extraction({ state = 'clot', title }: { state?: 'out' | 'clot' | 'healed'; title?: string }) {
  const { p, u } = useKit()
  const socket = 'M76,168 L83,280 C85,296 98,296 100,282 L108,216 C110,206 130,206 132,216 L140,282 C142,296 155,296 157,280 L164,168 Z'
  return (
    <svg viewBox="0 -60 240 380" role="img" aria-label={title} className="art" xmlns="http://www.w3.org/2000/svg">
      <Kit p={p} />
      <Jaw u={u} gumTop={state === 'healed' ? 150 : 162} />
      {state !== 'healed' && <path d={socket} fill={state === 'clot' ? u('clot') : '#E7B7A4'} stroke="#A07A55" strokeWidth={1.2} />}
      {state === 'healed' && <path d={socket} fill="#F5EAD3" opacity={0.6} />}
      {state === 'out' && (
        <g>
          <Mini u={u} x={120} y={36} s={0.62} rotate={-6} />
          <Move d="M200,70 V20 M192,30 L200,18 L208,30" />
        </g>
      )}
      {state === 'clot' && (
        <g>
          {/* Марлевый тампон: прикушен сверху */}
          <rect x={80} y={134} width={80} height={42} rx={12} fill="#FBFBF8" stroke="#A9B4B6" strokeWidth={1.2} />
          <path d="M88,144 H152 M88,154 H152 M88,164 H152 M98,138 V172 M112,138 V172 M126,138 V172 M140,138 V172" stroke="#D9E0E1" strokeWidth={1} />
        </g>
      )}
    </svg>
  )
}

/** Зуб мудрости: растёт под углом и давит на соседа; наполовину под десной; портит соседний зуб. */
export function Wisdom({ state = 'tilt', title }: { state?: 'tilt' | 'half' | 'decay'; title?: string }) {
  const { p, u } = useKit()
  const gumTop = `M0,118 C40,110 70,98 80,94 L150,94 C170,102 200,${state === 'half' ? 92 : 108} 320,${state === 'half' ? 98 : 116}`
  return (
    <svg viewBox="0 0 320 270" role="img" aria-label={title} className="art" xmlns="http://www.w3.org/2000/svg">
      <Kit p={p} />
      <rect x={0} y={126} width={320} height={150} rx={14} fill={u('bone')} />
      {/* Зуб мудрости — в кости под десной: десна рисуется поверх его коронки */}
      <Mini u={u} x={236} y={state === 'half' ? 160 : 178} s={0.6} rotate={-38} />
      <path d={`${gumTop} L320,148 L0,148 Z`} fill={u(state === 'half' ? 'gumRed' : 'gum')} opacity={0.92} />
      <path d={gumTop} fill="none" stroke={state === 'half' ? '#B23C4E' : '#C97C88'} strokeWidth={1.4} />
      <Mini u={u} x={110} y={128} s={0.62} caries={state === 'decay'} />
      {state === 'tilt' && <Move d="M196,92 L166,104 M176,96 L165,104 L174,112" />}
      {state === 'half' && <g fill="#B6874B" opacity={0.8}>{[[204, 92], [214, 86], [220, 96]].map(([x, y]) => <circle key={x} cx={x} cy={y} r={3} />)}</g>}
    </svg>
  )
}

/** Пустое место после потери зуба: кость убывает, соседи наклоняются, зуб сверху опускается. */
export function Gap({ stage = 1, title }: { stage?: 0 | 1 | 2 | 3; title?: string }) {
  const { p, u } = useKit()
  const dip = stage >= 1 ? 30 : 0
  const tilt = stage >= 2 ? 14 : 0
  const gum = `M0,176 L100,170 C130,${178 + dip / 2} 190,${178 + dip / 2} 220,170 L320,176`
  return (
    <svg viewBox="0 0 320 300" role="img" aria-label={title} className="art" xmlns="http://www.w3.org/2000/svg">
      <Kit p={p} />
      {stage >= 3 && (
        <g>
          <rect x={0} y={-20} width={320} height={50} rx={12} fill={u('bone')} />
          <Mini u={u} x={60} y={62} s={0.42} flip />
          <Mini u={u} x={160} y={84} s={0.42} flip />
          <Mini u={u} x={260} y={62} s={0.42} flip />
          <Move d="M196,96 V124 M189,116 L196,126 L203,116" />
        </g>
      )}
      <path d={`M0,190 L110,190 C130,${190 + dip} 190,${190 + dip} 210,190 L320,190 L320,310 L0,310 Z`} fill={u('bone')} />
      <path d={`${gum} L320,200 L0,200 Z`} fill={u('gum')} />
      <path d={gum} fill="none" stroke="#C97C88" strokeWidth={1.4} />
      <Mini u={u} x={64} y={206} s={0.46} rotate={tilt} />
      <Mini u={u} x={256} y={206} s={0.46} rotate={-tilt} />
      {stage >= 1 && <Move d="M140,232 L160,244 L180,232" />}
      {stage >= 2 && <Move d="M100,140 Q114,136 122,146 M116,138 L123,147 L112,149 M220,140 Q206,136 198,146 M204,138 L197,147 L208,149" />}
    </svg>
  )
}

/** Молочный зуб и постоянный под ним: здоров, кариес, до нерва, удалён рано — постоянный растёт криво. */
export function Kids({ state = 'ok', title, labels, lang = 'ru' }: { state?: 'ok' | 'caries' | 'deep' | 'lost'; title?: string; labels?: boolean; lang?: Lang }) {
  const { p, u } = useKit()
  return (
    <svg viewBox={`0 0 ${labels ? 410 : 240} 320`} role="img" aria-label={title} className="art" xmlns="http://www.w3.org/2000/svg">
      <Kit p={p} />
      <defs><clipPath id={`${p}c`}><rect x={0} y={-60} width={240} height={226} /></clipPath></defs>
      <Jaw u={u} boneTop={150} gumTop={120} />
      {/* Зачаток постоянного зуба в кости — в оболочке (мешочке) */}
      <g transform={state === 'lost' ? 'translate(120,250) rotate(-24) scale(0.55) translate(-120,-110)' : 'translate(120,254) scale(0.55) translate(-120,-110)'}>
        <ellipse cx={120} cy={110} rx={80} ry={74} fill="#F7EBD8" stroke="#C9AE86" strokeWidth={2.4} strokeDasharray="6 6" />
        <path d={CAP} fill={u('enamel')} />
        <path d={CAP} fill={u('shade')} />
        <path d={CAP} fill="none" stroke={LINE} strokeWidth={3} strokeLinejoin="round" />
      </g>
      {/* Молочный зуб — тот же разрез, меньше */}
      {state !== 'lost' && (
        <g transform="translate(120,92) scale(0.58) translate(-120,-120)">
          <path d={OUTER} fill={u('root')} />
          <path d={OUTER} fill={u('enamel')} clipPath={`url(#${p}c)`} />
          <path d={INNER} fill={u('dentin')} />
          {state === 'caries' && <path d={CARIES_HALO[3]} fill="#B98654" opacity={0.55} filter={u('soft')} />}
          <path d={CHAMBER} fill={u(state === 'deep' ? 'pulpHot' : 'pulp')} />
          <path d={CANALS} stroke={state === 'deep' ? '#C43A48' : '#DE8592'} strokeWidth={8} strokeLinecap="round" fill="none" />
          {state === 'caries' && <path d={CARIES_PATH[3]} fill={u('caries')} />}
          {state === 'deep' && <path d={CARIES_PATH[4]} fill={u('caries')} />}
          <path d={OUTER} fill={u('shade')} />
          <path d={OUTER} fill="none" stroke={LINE} strokeWidth={3.2} strokeLinejoin="round" />
        </g>
      )}
      {state === 'deep' && <ellipse cx={120} cy={196} rx={30} ry={18} fill={u('lesion')} />}
      {labels && <Callouts items={[[150, 70, 60, lang === 'ky' ? 'Сүт тиш' : 'Молочный зуб'], [160, 250, 250, lang === 'ky' ? 'Туруктуу тиш' : 'Постоянный зуб']]} />}
      {state === 'lost' && <path d="M90,126 C110,120 130,120 150,126" stroke="#C97C88" strokeWidth={1.4} fill="none" strokeLinecap="round" />}
    </svg>
  )
}

/** Отбеливание: передний зуб «было → стало» и шкала оттенков под ними. */
export function Whiten({ title, lang = 'ru', labels }: { title?: string; lang?: Lang; labels?: boolean }) {
  const { p, u } = useKit()
  // Передний зуб спереди: ровный режущий край сверху, к десне сужается
  const incisor = 'M2,8 C2,2 8,0 14,0 L56,0 C62,0 68,2 68,8 L64,70 C62,96 54,124 35,124 C16,124 8,96 6,70 Z'
  const shades = ['#FBF8F0', '#F6EFDD', '#F1E4C6', '#EBD9B2', '#E3CB9C', '#D9BC86']
  return (
    <svg viewBox="0 0 320 250" role="img" aria-label={title} className="art" xmlns="http://www.w3.org/2000/svg">
      <Kit p={p} />
      <path d="M0,0 H320 V46 C260,58 220,26 160,40 C100,26 60,58 0,46 Z" fill={u('gum')} />
      <g transform="translate(50,26)">
        <path d={incisor} fill={u('enamelY')} />
        <path d={incisor} fill={u('shade')} />
        <path d={incisor} fill="none" stroke={LINE} strokeWidth={1.6} />
      </g>
      <path d="M140,92 H176 M168,85 L177,92 L168,99" stroke={LEADER} strokeWidth={1.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <g transform="translate(200,26)">
        <path d={incisor} fill={u('enamel')} />
        <path d={incisor} fill={u('shade')} />
        <ellipse cx={22} cy={34} rx={6} ry={14} fill="#FFFFFF" opacity={0.9} filter={u('soft')} />
        <path d={incisor} fill="none" stroke={LINE} strokeWidth={1.6} />
      </g>
      {labels && (
        <g fontFamily="'Golos Text', sans-serif" fontWeight={500} fontSize={15} fill={TEXT} textAnchor="middle">
          <text x={85} y={172}>{lang === 'ky' ? 'Чейин' : 'До'}</text>
          <text x={235} y={172}>{lang === 'ky' ? 'Кийин' : 'После'}</text>
        </g>
      )}
      {/* Шкала оттенков: врач сравнивает цвет до и после */}
      <g transform="translate(64,190)">
        {shades.map((c, i) => <rect key={c} x={i * 33} y={0} width={26} height={40} rx={5} fill={c} stroke="#B9C3C5" strokeWidth={1} />)}
        <path d="M13,48 V54 M178,48 V54" stroke={TEAL} strokeWidth={2} strokeLinecap="round" />
      </g>
    </svg>
  )
}

/** Иллюстрация слайда: готовый элемент или ничего. */
export type Art = ReactNode
