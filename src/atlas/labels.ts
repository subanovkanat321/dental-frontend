import { CARIES_STAGES, numberedLabels, PARTS, UI, WISDOM, type AtlasMode, type AtlasView, type Lang, type PartId, type WisdomPosition } from './content'
import { fdiToIndex, toothTitle } from './fdi'
import { toothTip, wisdomAnchor } from './geometry/jawModel'

/** Метка на экране: номер, часть (для подписи) и точка в 3D. */
export interface ShownLabel {
  key: string
  n: number | string
  part?: PartId
  title?: string
  at: readonly [number, number, number]
}

/** Метки текущего вида: на разрезе — части по номерам, на челюсти — номер зуба, у мудрости — 38 и 47. */
export function atlasLabels(view: AtlasView, mode: AtlasMode, fdi: number | null, wisdom: WisdomPosition, lang: Lang): ShownLabel[] {
  if (view === 'tooth') return numberedLabels(mode).map((l) => ({ key: `${mode}-${l.part}`, n: l.n, part: l.part, at: l.at }))
  if (view === 'jaw') return fdi != null && fdiToIndex(fdi) != null ? [{ key: `fdi-${fdi}`, n: fdi, title: toothTitle(fdi, lang), at: toothTip(fdi) }] : []
  return [
    { key: 'w38', n: 38, title: toothTitle(38, lang), at: wisdomAnchor(wisdom) },
    { key: 'w37', n: 37, title: toothTitle(37, lang), at: [0, 0.62, 0.45] },
    { key: 'wbone', n: lang === 'ru' ? 'кость' : 'сөөк', part: 'bone', at: [-1.7, -1.7, 0.76] },
    { key: 'wgum', n: lang === 'ru' ? 'десна' : 'бил', part: 'gum', at: [-1.95, 0.06, 0.78] },
  ]
}

export function infoText(view: AtlasView, mode: AtlasMode, stage: number, part: PartId | null, fdi: number | null, wisdom: WisdomPosition, lang: Lang): { name: string; text: string } | null {
  if (view === 'wisdom') {
    const w = WISDOM.find((x) => x.id === wisdom)!
    return part ? PARTS[part][lang] : { name: `${UI[lang].wisdom}: ${w[lang].name}`, text: w[lang].text }
  }
  if (view === 'jaw') return fdi != null ? { name: toothTitle(fdi, lang), text: UI[lang].jawHint } : { name: UI[lang].jaw, text: UI[lang].jawHint }
  if (part) return PARTS[part][lang]
  if (mode === 'caries') {
    const s = CARIES_STAGES[stage]!
    return { name: `${PARTS.caries[lang].name}: ${s[lang].name.toLowerCase()}`, text: s[lang].text }
  }
  if (mode === 'healthy') return { name: UI[lang].tooth, text: UI[lang].hint }
  const main: Record<Exclude<AtlasMode, 'healthy' | 'caries'>, PartId> = { endo: 'gutta', filling: 'filling', crown: 'crown', implant: 'implant' }
  return PARTS[main[mode]][lang]
}

