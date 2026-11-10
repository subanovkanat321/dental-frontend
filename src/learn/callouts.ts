import type { L } from './catalog'

/**
 * Подписи частей зуба — общие для SVG-рисунков (art.tsx) и выносок поверх 3D-кадров (media.tsx), и
 * раскладка выносок по краям кадра. Без React: файл только с данными и функциями.
 */
export type LabelKey = 'enamel' | 'dentin' | 'pulp' | 'root' | 'gum' | 'bone' | 'tartar' | 'filling' | 'crown' | 'sealant' | 'caries' | 'canals'
/** Подпись на 3D-кадре: части из рисунков и части коронки и импланта. */
export type Part = LabelKey | 'stump' | 'implant' | 'abutment'

export const LABEL_TEXT: Record<LabelKey, L> = {
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

export const PART_TEXT: Record<Part, L> = {
  ...LABEL_TEXT,
  stump: { ru: 'Обточенный зуб', ky: 'Жонулган тиш' },
  implant: { ru: 'Имплант', ky: 'Имплант' },
  abutment: { ru: 'Опора (абатмент)', ky: 'Таяныч (абатмент)' },
}

/** Подпись → часть атласа, чья точка записана в shots.gen.ts (корень — по слою цемента на нём). */
export const PART_KEY: Partial<Record<Part, string>> = { root: 'cementum', canals: 'canal' }

export type Placed = { key: Part; x: number; y: number; side: 'l' | 'r'; ly: number }

/** Минимальный шаг подписей по высоте (доля кадра) — чтобы не налезали друг на друга. */
export const GAP = 0.085

/**
 * Подписи по краям кадра (как выноски в атласе): каждая — в колонке ближнего края, тонкая линия ведёт к
 * точке на ткани. Близкие по высоте подписи раздвигаются, линия идёт наискосок.
 */
export function placeCallouts(points: { key: Part; x: number; y: number }[]): Placed[] {
  const out: Placed[] = []
  for (const side of ['l', 'r'] as const) {
    const list = points.filter((p) => (p.x < 0.5 ? 'l' : 'r') === side).sort((a, b) => a.y - b.y)
    let prev = -1
    const placed = list.map((p) => {
      const ly = Math.max(p.y, prev + GAP, 0.05)
      prev = ly
      return { ...p, side, ly }
    })
    // Нижние уехали за край — сдвинуть всю колонку вверх
    const over = (placed.at(-1)?.ly ?? 0) - 0.95
    if (over > 0) for (const p of placed) p.ly = Math.max(0.05, p.ly - over)
    out.push(...placed)
  }
  return out
}
