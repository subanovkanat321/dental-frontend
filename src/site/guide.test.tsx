import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { vi } from 'vitest'

import type { Schemas } from '../api/client'
import { GuidePage } from '../settings/GuidePage'
import { guideRole } from '../settings/guides'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { Guide } from './Guide'
import { allImages, CHAPTERS, chaptersFor } from './guide/content'
import { SIZES } from './guide/sizes'

/** Файлы public/guide — как в contentPlan.test.ts: список от Vite, без чтения диска из теста. */
const files = new Set(Object.keys(import.meta.glob('../../public/guide/*')).map((f) => f.replace('../../public/guide/', '')))

afterEach(() => {
  window.history.replaceState(null, '', '/')
})

const chapterTitles = () => within(screen.getByRole('navigation', { name: 'Оглавление' })).getAllByRole('link').map((a) => a.textContent)

test('/guide открывается без входа: заголовок, переключатель ролей, оглавление со ссылками на главы', () => {
  window.history.replaceState(null, '', '/guide')
  render(<Guide />)
  expect(screen.getByRole('heading', { level: 1, name: 'Руководство Tish' })).toBeInTheDocument()
  expect(within(screen.getByRole('group', { name: 'Для кого' })).getByRole('button', { name: 'Все главы' })).toHaveAttribute('aria-pressed', 'true')
  expect(chapterTitles()).toEqual(CHAPTERS.map((c) => c.title))
  // Якорь ведёт на главу с тем же id
  const link = within(screen.getByRole('navigation', { name: 'Оглавление' })).getByRole('link', { name: 'Расписание' })
  expect(link).toHaveAttribute('href', '#raspisanie')
  expect(document.getElementById('raspisanie')).toHaveTextContent('Новая запись')
})

test('?role=assistant — без «Кассы» и «Настроек клиники»; выбор роли — в адресе', async () => {
  window.history.replaceState(null, '', '/guide?role=assistant')
  render(<Guide />)
  expect(chapterTitles()).not.toContain('Настройки клиники')
  expect(chapterTitles()).not.toContain('Касса')
  expect(chapterTitles()).toContain('Пациенты')
  // Разделы, которые ассистенту не нужны, тоже скрыты: оплату он не принимает
  expect(screen.queryByRole('article', { name: 'Оплата после приёма' })).not.toBeInTheDocument()
  expect(screen.getByRole('article', { name: '«Профосмотр» (у ассистента)' })).toBeInTheDocument()

  await userEvent.click(within(screen.getByRole('group', { name: 'Для кого' })).getByRole('button', { name: 'Администратор' }))
  expect(window.location.search).toBe('?role=admin')
  expect(chapterTitles()).toContain('Настройки клиники')
  expect(screen.getByRole('article', { name: 'Сотрудники: регистратура, ассистенты, администраторы' })).toBeInTheDocument()

  await userEvent.click(within(screen.getByRole('group', { name: 'Для кого' })).getByRole('button', { name: 'Все главы' }))
  expect(window.location.search).toBe('')
})

test('у регистратуры — касса без выручки: «К оплате на кассе», но не «Зарплата»', () => {
  const titles = chaptersFor('reception').flatMap((c) => c.sections.map((s) => s.title))
  expect(titles).toContain('К оплате на кассе (регистратура)')
  expect(titles).not.toContain('Зарплата: проценты и оклад')
  expect(chaptersFor('reception').map((c) => c.id)).toContain('nastroiki-kliniki')
  expect(chaptersFor('assistant').map((c) => c.id)).not.toContain('nastroiki-kliniki')
})

test('неизвестная роль в адресе — все главы', () => {
  window.history.replaceState(null, '', '/guide?role=boss')
  render(<Guide />)
  expect(chapterTitles()).toHaveLength(CHAPTERS.length)
})

test('картинки: у каждой есть файл в public/guide, размер, alt и подпись; грузятся лениво', () => {
  const images = allImages()
  expect(images.length).toBeGreaterThan(30)
  for (const image of images) {
    expect(files.has(image.src), image.src).toBe(true)
    expect(SIZES[image.src], image.src).toBeDefined()
    expect(image.alt.length, image.src).toBeGreaterThan(5)
    expect(image.caption.length, image.src).toBeGreaterThan(3)
  }
  render(<Guide />)
  const img = screen.getByRole('img', { name: /Расписание «День»/ })
  expect(img).toHaveAttribute('loading', 'lazy')
  expect(img).toHaveAttribute('src', '/guide/den-kompyuter.webp')
  expect(img).toHaveAttribute('width', String(SIZES['den-kompyuter.webp']![0]))
})

test('id глав и названия разделов не повторяются (якоря и ключи React)', () => {
  expect(new Set(CHAPTERS.map((c) => c.id)).size).toBe(CHAPTERS.length)
  for (const c of CHAPTERS) expect(new Set(c.sections.map((s) => s.title)).size, c.id).toBe(c.sections.length)
})

type Me = Schemas['BookingViewsMe']

test('ссылка из CRM — на роль сотрудника; админ, который и врач, получает главы администратора', () => {
  expect(guideRole({ admin: true, doctorId: 1 } as Me)).toBe('admin')
  expect(guideRole({ doctorId: 1 } as Me)).toBe('doctor')
  expect(guideRole({ reception: true } as Me)).toBe('reception')
  expect(guideRole({ assistantOf: [1] } as Me)).toBe('assistant')
})

test('«Памятка»: «Полное руководство с картинками» — для выбранной роли', async () => {
  const open = vi.spyOn(window, 'open').mockImplementation(() => null)
  render(<GuidePage me={{ assistantOf: [1], doctors: [] } as Me} onBack={vi.fn()} />)
  const link = screen.getByRole('link', { name: /Полное руководство с картинками/ })
  expect(link).toHaveAttribute('href', `${window.location.origin}/guide?role=assistant`)
  await userEvent.click(within(screen.getByRole('group', { name: 'Роль' })).getByRole('button', { name: 'Врач' }))
  await userEvent.click(screen.getByRole('link', { name: /Полное руководство с картинками/ }))
  expect(open).toHaveBeenCalledWith(`${window.location.origin}/guide?role=doctor`, '_blank', 'noopener')
})

test('«Настройки → Профиль и помощь»: «Руководство» открывает /guide для своей роли', async () => {
  const open = vi.spyOn(window, 'open').mockImplementation(() => null)
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', () => HttpResponse.json([])),
  )
  window.location.hash = '/settings'
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: /Руководство/ }))
  expect(open).toHaveBeenCalledWith(`${window.location.origin}/guide?role=admin`, '_blank', 'noopener')
  window.location.hash = ''
})
