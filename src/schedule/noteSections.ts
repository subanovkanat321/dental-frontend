import type { Schemas } from '../api/client'

export type Sections = Schemas['NoteSections']

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

/** Хоть один раздел с текстом. */
export function hasText(s: Sections | null | undefined): boolean {
  return !!s && KEYS.some((k) => (s[k] ?? '').trim() !== '')
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
  return out
}

/** Убрать пробелы по краям и пустые разделы (в запрос). */
export function cleanSections(s: Sections): Sections {
  const out: Sections = {}
  for (const k of KEYS) {
    const v = (s[k] ?? '').trim()
    if (v) out[k] = v
  }
  return out
}

/** Тот же текст, что собирает сервер: «Жалобы: …» строками, затем текст вне разделов. */
export function renderSections(s: Sections | null | undefined): string {
  if (!s) return ''
  const lines = SECTIONS.filter(([k]) => (s[k] ?? '').trim()).map(([k, t]) => `${t}: ${(s[k] ?? '').trim()}`)
  if ((s.other ?? '').trim()) lines.push((s.other ?? '').trim())
  return lines.join('\n')
}

/** Заметка как разделы: с разделами — они, простая — весь текст в «Заметку» (other). */
export function asSections(note: string | null | undefined, sections: Sections | null | undefined): Sections {
  if (sections) return { ...sections }
  return note?.trim() ? { other: note.trim() } : {}
}

export function sameSections(a: Sections, b: Sections): boolean {
  return KEYS.every((k) => (a[k] ?? '').trim() === (b[k] ?? '').trim())
}
