import { CHAPTER_ALIAS, sectionId, type GuideChapter, type GuideSection } from '../site/guide/content'

/**
 * «Руководство» в CRM — книга из глав site/guide/content.ts (тех же, что у /guide на сайте). Здесь только логика без
 * React: страницы по порядку («‹ Предыдущая | Следующая ›»), адрес раздела, поиск и «где остановились».
 *
 * Страница — начало главы (её вступление и список разделов) или один раздел. Адрес — #/help/guide/<глава>/<раздел>.
 */
export type BookPage = { chapter: GuideChapter; section: GuideSection | null }

/** Все страницы книги по порядку: глава, её разделы, следующая глава… */
export function pagesOf(chapters: GuideChapter[]): BookPage[] {
  return chapters.flatMap((chapter) => [{ chapter, section: null }, ...chapter.sections.map((section) => ({ chapter, section }))])
}

/** Место в книге: глава и, если открыт раздел, его якорь. */
export type Place = { chapter: string; section?: string }

/** Адрес места (без «#»): /help/guide/kassa/obschie-rashody. Без места — оглавление. */
export function placeHash(place: Place | null): string {
  if (!place) return '/help/guide'
  return `/help/guide/${place.chapter}${place.section ? `/${place.section}` : ''}`
}

/** Части адреса после #/help/guide/: ['kassa', 'obschie-rashody']; не руководство — null. */
export function hashPlaceParts(hash = window.location.hash): string[] | null {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  if (parts[0] !== 'help' || parts[1] !== 'guide') return null
  return parts.slice(2).map((p) => {
    try {
      return decodeURIComponent(p)
    } catch {
      return p
    }
  })
}

/**
 * Место по частям адреса. Понимает и старые ссылки подсказок «?» и бота — один якорь без главы (#/help/guide/novaya-zapis,
 * /guide#kassa), и старые id глав (nastroiki-kliniki). Раздел не в той главе — найдём, где он сейчас. Не нашли — null.
 */
export function resolvePlace(parts: string[], chapters: GuideChapter[]): Place | null {
  const [first, second] = parts
  if (!first) return null
  const chapterId = CHAPTER_ALIAS[first] ?? first
  const chapter = chapters.find((c) => c.id === chapterId)
  if (chapter) {
    if (second && chapter.sections.some((s) => sectionId(s) === second)) return { chapter: chapter.id, section: second }
    if (second) {
      const moved = findSection(second, chapters)
      if (moved) return moved
    }
    return { chapter: chapter.id }
  }
  return findSection(first, chapters)
}

function findSection(id: string, chapters: GuideChapter[]): Place | null {
  for (const c of chapters) {
    if (c.sections.some((s) => sectionId(s) === id)) return { chapter: c.id, section: id }
  }
  return null
}

/** Номер страницы места в книге; нет такого — -1. */
export function pageIndex(pages: BookPage[], place: Place): number {
  return pages.findIndex((p) => p.chapter.id === place.chapter && (place.section ? p.section != null && sectionId(p.section) === place.section : p.section == null))
}

export function placeOf(page: BookPage): Place {
  return page.section ? { chapter: page.chapter.id, section: sectionId(page.section) } : { chapter: page.chapter.id }
}

/** Текст раздела одной строкой — для поиска и отрывка в результатах. */
function sectionText(s: GuideSection): string {
  return [s.text, ...s.steps, s.tip].filter(Boolean).join(' ')
}

/** Для сравнения: строчные, «ё» как «е», лишние пробелы — один. */
export function fold(text: string): string {
  return text.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ')
}

export type Hit = {
  chapter: GuideChapter
  section: GuideSection | null
  /** Отрывок вокруг первого найденного слова: [до, слово, после] */
  snippet: [string, string, string]
}

const SNIPPET = 60

/**
 * Поиск по руководству — локально, по заголовкам и тексту: все слова запроса должны найтись. Сначала совпадения в
 * заголовке раздела, потом в тексте; порядок внутри — как в книге. Короче 2 букв — ничего.
 */
export function searchBook(query: string, chapters: GuideChapter[], limit = 30): Hit[] {
  const words = fold(query).trim().split(' ').filter((w) => w.length > 0)
  if (!words.length || words.join('').length < 2) return []
  const inTitle: Hit[] = []
  const inText: Hit[] = []
  for (const chapter of chapters) {
    const items: [GuideSection | null, string, string][] = [
      [null, chapter.title, chapter.intro],
      ...chapter.sections.map((s): [GuideSection, string, string] => [s, s.title, sectionText(s)]),
    ]
    for (const [section, title, text] of items) {
      const t = fold(title)
      const body = fold(text)
      const all = `${t} ${body}`
      if (!words.every((w) => all.includes(w))) continue
      const hit: Hit = { chapter, section, snippet: snippetOf(text, words) }
      ;(words.some((w) => t.includes(w)) ? inTitle : inText).push(hit)
    }
  }
  return [...inTitle, ...inText].slice(0, limit)
}

/** Отрывок текста вокруг первого слова запроса (позиции «ё»/«е» совпадают — длина та же). */
function snippetOf(text: string, words: string[]): [string, string, string] {
  const flat = text.replace(/\s+/g, ' ')
  const folded = fold(flat)
  const at = words.map((w) => folded.indexOf(w)).filter((i) => i >= 0).sort((a, b) => a - b)[0]
  if (at == null) return [flat.length > SNIPPET * 2 ? `${flat.slice(0, SNIPPET * 2)}…` : flat, '', '']
  const word = words.find((w) => folded.startsWith(w, at))!
  const start = Math.max(0, at - SNIPPET)
  const end = Math.min(flat.length, at + word.length + SNIPPET)
  return [`${start > 0 ? '…' : ''}${flat.slice(start, at)}`, flat.slice(at, at + word.length), `${flat.slice(at + word.length, end)}${end < flat.length ? '…' : ''}`]
}

const LAST = 'tish.guide.last'

/** Где остановились: «глава/раздел» — не персональные данные; хранилище недоступно (приватный режим) — молча без него. */
export function readLast(): string[] | null {
  try {
    const v = window.localStorage.getItem(LAST)
    return v ? v.split('/').filter(Boolean) : null
  } catch {
    return null
  }
}

export function saveLast(place: Place): void {
  try {
    window.localStorage.setItem(LAST, place.section ? `${place.chapter}/${place.section}` : place.chapter)
  } catch {
    // хранилище недоступно — в следующий раз откроется оглавление
  }
}
