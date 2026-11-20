import type { Schemas } from '../api/client'
// Готовый план из сборки: бэкенд забирает его с сайта (ContentAutoImport) — пост с ошибкой он молча пропустит
import raw from '../../public/content/plan.json?raw'

// Те же правила, что у бэкенда (ContentPosts.valid): поменялись там — меняем здесь
const KINDS = ['POST', 'CAROUSEL', 'REELS', 'STORIES']
const IMAGE = /^\/content\/[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/
const plan = JSON.parse(raw) as Schemas['ContentPostsDraft'][]
// Какие картинки есть на диске: ключи вида «../../public/content/файл.png» → «/content/файл.png»
const files = new Set(Object.keys(import.meta.glob('../../public/content/**/*')).map((f) => f.replace('../../public', '')))

test('контент-план: каждый пост проходит проверку бэкенда, ключи «день + название» не повторяются', () => {
  expect(plan.length).toBeGreaterThan(0)
  expect(plan.length).toBeLessThanOrEqual(400)
  const keys = new Set<string>()
  for (const p of plan) {
    const where = `${p.date} «${p.title}»`
    expect(Object.keys(p).sort(), where).toEqual(['caption', 'date', 'images', 'kind', 'note', 'title'])
    expect(p.date, where).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(Number.isNaN(Date.parse(p.date!)), where).toBe(false)
    expect(KINDS, where).toContain(p.kind)
    const title = p.title?.trim() ?? ''
    expect(title.length, where).toBeGreaterThan(0)
    expect(title.length, where).toBeLessThanOrEqual(200)
    expect(p.caption?.trim().length ?? 0, where).toBeLessThanOrEqual(4000)
    expect(p.note?.trim().length ?? 0, where).toBeLessThanOrEqual(2000)
    expect(p.images?.length ?? 0, where).toBeLessThanOrEqual(10)
    expect(keys.has(`${p.date}\n${title}`), `${where} — дважды`).toBe(false)
    keys.add(`${p.date}\n${title}`)
  }
})

test('контент-план: все картинки лежат в public/content', () => {
  for (const p of plan) {
    expect(p.images?.length, `${p.date} «${p.title}» без картинок`).toBeGreaterThan(0)
    for (const image of p.images ?? []) {
      expect(image).toMatch(IMAGE)
      expect(image.includes('..')).toBe(false)
      expect(files.has(image), image).toBe(true)
    }
  }
})

test('контент-план: у постов и каруселей есть подпись, у сторис — заметка', () => {
  for (const p of plan) {
    if (p.kind === 'STORIES') expect(p.note, `${p.date} «${p.title}»`).not.toBe('')
    else expect(p.caption?.length, `${p.date} «${p.title}»`).toBeGreaterThan(0)
  }
})

// С 06.11 всё публикуется кнопкой «Опубликовать в Instagram» целиком: без Reels и без того, что
// нужно доделывать руками в приложении (опросы, стикеры, ссылки, музыка)
const AUTO_FROM = '2026-11-06'
// «(?<![а-яё])опрос» — слово «опрос», а не «вопрос»
const MANUAL = /(?<![а-яё])опрос|стикер|голосуй|викторин[уа] в сторис|слайдер|ссылк[аеуи] в сторис|музык/iu

test('контент-план с 06.11: только пост, карусель и сторис — всё публикуется кнопкой само', () => {
  const auto = plan.filter((p) => p.date! >= AUTO_FROM)
  // С 21.11 — только посты для клиник (аудит Instagram 2026-11-20): пациентские сняты в PATIENT_PARKED
  expect(auto.length).toBeGreaterThanOrEqual(18)
  expect((auto.at(-1)?.date ?? '') >= '2026-12-06').toBe(true)
  for (const p of auto) {
    const where = `${p.date} «${p.title}»`
    expect(['POST', 'CAROUSEL', 'STORIES'], where).toContain(p.kind)
    const images = p.images?.length ?? 0
    if (p.kind === 'POST') expect(images, where).toBe(1)
    if (p.kind === 'CAROUSEL') expect(images >= 2 && images <= 10, where).toBe(true)
    if (p.kind === 'STORIES') expect(images, where).toBeGreaterThan(0)
    // Instagram: подпись до 2200 символов и до 30 хештегов; держим до 10
    expect(p.caption!.length, where).toBeLessThanOrEqual(2200)
    expect((p.caption!.match(/#[\p{L}\d_]+/gu) ?? []).length, where).toBeLessThanOrEqual(10)
    expect(`${p.title} ${p.caption} ${p.note}`, where).not.toMatch(MANUAL)
  }
})

// Аудит Instagram 2026-11-20: с 21.11 в плане только клиникам — без призыва «Записаться к стоматологу», с кодовым
// словом в директ, 3–5 нишевыми хэштегами с «#» и без служебных пометок
test('контент-план с 21.11: только для клиник, кодовое слово в директ, хэштеги с «#»', () => {
  const next = plan.filter((p) => p.date! > '2026-11-20')
  expect(next.length).toBeGreaterThan(0)
  for (const p of next) {
    const where = `${p.date} «${p.title}»`
    const text = `${p.title} ${p.caption} ${p.note}`
    expect(text, where).not.toMatch(/Записаться к стоматологу|Запишитесь|проверить носителем|не заменяет осмотр|30 дней бесплатно|месяц[а-я]* бесплатно/)
    expect(p.title, where).toMatch(/^Клиникам/)
    if (p.kind === 'STORIES') continue
    expect(p.caption, where).toMatch(/Напишите [А-ЯЁ]+ в директ — .*подключим бесплатно\./)
    const tags = p.caption!.match(/#[\p{L}\d_]+/gu) ?? []
    expect(tags.length >= 3 && tags.length <= 5, where).toBe(true)
    // Слово-хэштег без «#» в строке хэштегов
    const last = p.caption!.trim().split('\n').at(-1) ?? ''
    expect(last.split(' ').every((w) => w.startsWith('#')), where).toBe(true)
  }
})
