import type { Schemas } from '../api/client'

export type Sections = Schemas['NoteSections']
/** Диагноз по МКБ-10 (шаг 3): код, название из списка, зуб (необязательно). */
export type Dx = Schemas['DiagnosisCode']

/** Разделы заметки (V238) по порядку; other — текст вне разделов (прежняя заметка), подпись «Заметка». */
export type SectionKey = 'complaints' | 'objective' | 'diagnosis' | 'treatment' | 'recommendations'

export const SECTIONS: [SectionKey, string][] = [
  ['complaints', 'Жалобы'],
  ['objective', 'Объективно'],
  ['diagnosis', 'Диагноз'],
  ['treatment', 'Лечение'],
  ['recommendations', 'Рекомендации'],
]

export const SECTION_TITLE: Record<SectionKey | 'other', string> = {
  complaints: 'Жалобы', objective: 'Объективно', diagnosis: 'Диагноз', treatment: 'Лечение', recommendations: 'Рекомендации', other: 'Заметка',
}

const KEYS: (SectionKey | 'other')[] = ['complaints', 'objective', 'diagnosis', 'treatment', 'recommendations', 'other']

/** Хоть один раздел с текстом или диагноз МКБ. */
export function hasText(s: Sections | null | undefined): boolean {
  return !!s && (KEYS.some((k) => (s[k] ?? '').trim() !== '') || (s.diagnosisCodes ?? []).length > 0)
}

/** «K02.1 Кариес дентина · 36» — чип диагноза. */
export function dxLabel(d: Dx): string {
  return `${d.code}${d.title ? ` ${d.title}` : ''}${d.tooth != null ? ` · ${d.tooth}` : ''}`
}

const dxKey = (d: Dx) => `${d.code}|${d.tooth ?? ''}`

/** Диагнозы + диагнозы без повторов (тот же код у того же зуба). */
export function mergeCodes(a: Dx[] | null | undefined, b: Dx[] | null | undefined): Dx[] {
  const out: Dx[] = []
  for (const d of [...(a ?? []), ...(b ?? [])]) if (!out.some((x) => dxKey(x) === dxKey(d))) out.push(d)
  return out
}

/** «Диагноз: K02.1 Кариес дентина, зуб 36 — текст» — как собирает сервер (NoteSections.diagnosisText). */
function diagnosisLine(s: Sections): string {
  const codes = (s.diagnosisCodes ?? []).map((d) => `${d.code}${d.title ? ` ${d.title}` : ''}${d.tooth != null ? `, зуб ${d.tooth}` : ''}`).join('; ')
  const text = (s.diagnosis ?? '').trim()
  return codes && text ? `${codes} — ${text}` : codes || text
}

/** Дописать текст к тексту строкой ниже; уже есть — не повторять. */
export function joinText(before: string | undefined, added: string | undefined): string {
  const a = (before ?? '').trim()
  const b = (added ?? '').trim()
  if (!a) return b
  if (!b || a.includes(b)) return a
  return `${a}\n${b}`
}

/** Разделы + разделы: каждый дописывается к своему. */
export function mergeSections(base: Sections | null | undefined, added: Sections | null | undefined): Sections {
  const out: Sections = {}
  for (const k of KEYS) {
    const v = joinText(base?.[k], added?.[k])
    if (v) out[k] = v
  }
  const codes = mergeCodes(base?.diagnosisCodes, added?.diagnosisCodes)
  if (codes.length) out.diagnosisCodes = codes
  return out
}

/** Убрать пробелы по краям и пустые разделы (в запрос). */
export function cleanSections(s: Sections): Sections {
  const out: Sections = {}
  for (const k of KEYS) {
    const v = (s[k] ?? '').trim()
    if (v) out[k] = v
  }
  const codes = mergeCodes(s.diagnosisCodes, [])
  if (codes.length) out.diagnosisCodes = codes.map((d) => ({ code: d.code, title: d.title, tooth: d.tooth ?? undefined }))
  return out
}

/** Тот же текст, что собирает сервер: «Жалобы: …» строками, затем текст вне разделов. */
export function renderSections(s: Sections | null | undefined): string {
  if (!s) return ''
  const lines = SECTIONS.map(([k, t]): [string, string] => [t, k === 'diagnosis' ? diagnosisLine(s) : (s[k] ?? '').trim()])
    .filter(([, v]) => v).map(([t, v]) => `${t}: ${v}`)
  if ((s.other ?? '').trim()) lines.push((s.other ?? '').trim())
  return lines.join('\n')
}

/** Заметка как разделы: с разделами — они, простая — весь текст в «Заметку» (other). */
export function asSections(note: string | null | undefined, sections: Sections | null | undefined): Sections {
  if (sections) return { ...sections }
  return note?.trim() ? { other: note.trim() } : {}
}

export function sameSections(a: Sections, b: Sections): boolean {
  const codes = (s: Sections) => (s.diagnosisCodes ?? []).map(dxKey).join(',')
  return KEYS.every((k) => (a[k] ?? '').trim() === (b[k] ?? '').trim()) && codes(a) === codes(b)
}
