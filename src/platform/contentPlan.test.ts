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

test('контент-план: у постов, каруселей и рилсов есть подпись, у сторис — заметка со стикером', () => {
  for (const p of plan) {
    if (p.kind === 'STORIES') expect(p.note, `${p.date} «${p.title}»`).not.toBe('')
    else expect(p.caption?.length, `${p.date} «${p.title}»`).toBeGreaterThan(0)
  }
})
