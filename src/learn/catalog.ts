/**
 * Темы презентаций «📖 Показать пациенту» — лёгкий список для основного бандла: адрес темы,
 * название, значок и слова, по которым тема подбирается к услуге приёма. Сами слайды и рисунки —
 * в отдельном чанке (topics.tsx, Presentation.tsx). slug и порядок — как LessonTopic бэкенда.
 */
export type Lang = 'ru' | 'ky'
export type L = Record<Lang, string>

export type TopicSlug = 'caries' | 'canals' | 'extraction' | 'hygiene' | 'filling' | 'crown' | 'implant' | 'whitening' | 'gums' | 'kids'

export type TopicInfo = { slug: TopicSlug; emoji: string; title: L; bg: string }

export const TOPICS: TopicInfo[] = [
  { slug: 'caries', emoji: '🦷', title: { ru: 'Кариес', ky: 'Кариес' }, bg: '#DDF3EC' },
  { slug: 'canals', emoji: '🔬', title: { ru: 'Пульпит и лечение каналов', ky: 'Пульпит жана каналдарды дарылоо' }, bg: '#FFE6D5' },
  { slug: 'extraction', emoji: '🩹', title: { ru: 'Удаление зуба и зуб мудрости', ky: 'Тиш жулуу жана акыл тиш' }, bg: '#E9E3FB' },
  { slug: 'hygiene', emoji: '✨', title: { ru: 'Профессиональная чистка', ky: 'Кесипкөй тазалоо' }, bg: '#DCEFF4' },
  { slug: 'filling', emoji: '🧩', title: { ru: 'Пломба и вкладка', ky: 'Пломба жана вкладка' }, bg: '#FFF3CC' },
  { slug: 'crown', emoji: '👑', title: { ru: 'Коронка', ky: 'Коронка' }, bg: '#FFE1E7' },
  { slug: 'implant', emoji: '🔩', title: { ru: 'Имплант', ky: 'Имплант' }, bg: '#E0F2EF' },
  { slug: 'whitening', emoji: '💎', title: { ru: 'Отбеливание', ky: 'Агартуу' }, bg: '#E6EEFF' },
  { slug: 'gums', emoji: '🌸', title: { ru: 'Дёсны: гингивит и пародонтит', ky: 'Бүйлө: гингивит жана пародонтит' }, bg: '#FFE4DC' },
  { slug: 'kids', emoji: '🧸', title: { ru: 'Детские зубы и герметизация', ky: 'Балдардын тиштери жана герметизация' }, bg: '#EEF5D6' },
]

/**
 * Слова в названии услуги → тема. Порядок важен: сначала узкие («имплант», «детск»), потом общие —
 * «Лечение каналов» не станет «Кариесом», «Детская пломба» — «Детскими зубами».
 */
const MATCH: [TopicSlug, string[]][] = [
  ['implant', ['имплант']],
  ['kids', ['детск', 'молочн', 'фиссур', 'герметиз', 'ребён', 'ребен']],
  ['canals', ['канал', 'пульпит', 'эндодонт', 'периодонтит', 'депульп']],
  ['extraction', ['удален', 'удалит', 'мудрост', 'экстракц']],
  ['whitening', ['отбел']],
  ['hygiene', ['чистк', 'гигиен', 'камн', 'air flow', 'airflow', 'эйр флоу', 'скейл']],
  ['gums', ['дёсн', 'десн', 'гингив', 'пародонт', 'кюретаж']],
  ['crown', ['коронк', 'протез', 'металлокерам', 'циркон', 'e.max', 'винир']],
  ['caries', ['кариес']],
  ['filling', ['пломб', 'вкладк', 'реставрац']],
]

/** Тема к услуге приёма по словам названия; не нашлось — null (врач выберет сам). */
export function topicForService(name?: string | null): TopicSlug | null {
  const n = (name ?? '').toLowerCase()
  if (!n) return null
  return MATCH.find(([, keys]) => keys.some((k) => n.includes(k)))?.[0] ?? null
}

export function topicInfo(slug: string | null | undefined): TopicInfo | undefined {
  return TOPICS.find((t) => t.slug === slug)
}

/** Ссылка на тему без входа: цены этой клиники по её коду, язык пациента. Без имени и диагноза. */
export function lessonUrl(origin: string, slug: TopicSlug, clinicCode?: string | null, lang: Lang = 'ru'): string {
  const params = new URLSearchParams()
  if (clinicCode) params.set('c', clinicCode)
  if (lang === 'ky') params.set('lang', 'ky')
  const query = params.toString()
  return `${origin}/learn/${slug}${query ? `?${query}` : ''}`
}
