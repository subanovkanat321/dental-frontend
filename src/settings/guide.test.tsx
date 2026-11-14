import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import type { Schemas } from '../api/client'
import { hashPlaceParts, pageIndex, pagesOf, resolvePlace, searchBook, startPages } from '../help/book'
import { CHAPTERS, chaptersFor, sectionId } from '../site/guide/content'
import { GuidePage } from './GuidePage'
import { ownRole } from './guides'
import { ItemHost } from './itemHost'

type Me = Schemas['BookingViewsMe']
const me = (over: Partial<Me>): Me => ({ admin: false, reception: false, doctors: [], doctor: false, owner: false, platform: false, bookingEnabled: false, daysAhead: 0, canChangeClinic: false, waiting: false, hasReception: false, hasCard: false, maxRelatives: 0, ...over }) as Me

afterEach(() => {
  window.localStorage.clear()
  window.history.replaceState(null, '', '/')
})

function renderBook(who: Partial<Me> = { admin: true }, back = vi.fn()) {
  return render(<ItemHost.Provider value="help"><GuidePage me={me(who)} onBack={back} /></ItemHost.Provider>)
}

const reader = () => screen.getByRole('article')

test('своя роль первой: ассистент, врач, регистратура, администратор', () => {
  expect(ownRole(me({ assistantOf: [1], doctorId: 2 }))).toBe('assistant')
  expect(ownRole(me({ doctorId: 2, admin: true }))).toBe('doctor')
  expect(ownRole(me({ reception: true, admin: true }))).toBe('reception')
  expect(ownRole(me({ admin: true }))).toBe('admin')
})

test('у каждого раздела свой адрес: якоря не повторяются во всей книге', () => {
  const ids = CHAPTERS.flatMap((c) => c.sections.map(sectionId))
  expect(new Set(ids).size).toBe(ids.length)
  ids.forEach((id) => expect(id).toMatch(/^[a-z0-9-]+$/))
  expect(CHAPTERS.map((c) => c.title)).toEqual(expect.arrayContaining(['Начало работы', 'Расписание', 'Пациенты', 'Для пациента', 'Касса', 'Склад', 'Клиника', 'Настройки']))
})

test('видео про установку приложения убрано — одна строка «Я → Установить приложение»', () => {
  const all = CHAPTERS.flatMap((c) => c.sections)
  expect(all.some((s) => s.video === 'prilozhenie')).toBe(false)
  const install = all.find((s) => s.id === 'ustanovit-prilozhenie')!
  expect(install.text).toMatch(/«Я» → «Установить приложение»/)
  expect(install.steps).toHaveLength(0)
  // Устаревших названий «Помощи» в книге нет
  expect(JSON.stringify(CHAPTERS)).not.toMatch(/Помощь и техподдержка|«Техподдержк|Открыть полное руководство/)
})

test('адрес: глава/раздел, один старый якорь подсказки и старая глава «Настройки клиники»', () => {
  expect(hashPlaceParts('#/help/guide/kassa/x')).toEqual(['kassa', 'x'])
  expect(hashPlaceParts('#/help/videos')).toBeNull()
  expect(resolvePlace(['raspisanie', 'novaya-zapis'], CHAPTERS)).toEqual({ chapter: 'raspisanie', section: 'novaya-zapis' })
  expect(resolvePlace(['novaya-zapis'], CHAPTERS)).toEqual({ chapter: 'raspisanie', section: 'novaya-zapis' })
  expect(resolvePlace(['kassa'], CHAPTERS)).toEqual({ chapter: 'kassa' })
  expect(resolvePlace(['nastroiki-kliniki'], CHAPTERS)).toEqual({ chapter: 'klinika' })
  // Раздел переехал в другую главу — найдём, где он сейчас
  expect(resolvePlace(['nastroiki-kliniki', 'import'], CHAPTERS)).toEqual({ chapter: 'nastroiki', section: 'import' })
  expect(resolvePlace(['net-takogo'], CHAPTERS)).toBeNull()
})

test('поиск по заголовкам и тексту: сначала заголовки, все слова, «ё» как «е»', () => {
  const hits = searchBook('общие расходы', CHAPTERS)
  expect(hits[0]!.section?.title).toBe('Общие расходы: аренда кабинета, коммуналка')
  expect(searchBook('ПРИЕМ состоялся', CHAPTERS).length).toBeGreaterThan(0)
  const [before, word] = searchBook('доплатой', CHAPTERS)[0]!.snippet
  expect(word.toLowerCase()).toBe('доплатой')
  expect(before.length).toBeLessThanOrEqual(61)
  expect(searchBook('ы', CHAPTERS)).toEqual([])
  expect(searchBook('абракадабра', CHAPTERS)).toEqual([])
})

test('без адреса и прошлого чтения — оглавление глав и поиск в его колонке; глава → разделы; «‹ Назад» уходит', async () => {
  const back = vi.fn()
  renderBook({ admin: true }, back)
  const toc = screen.getByRole('navigation', { name: 'Оглавление' })
  expect(within(toc).getByRole('group', { name: 'Какие главы' })).toBeInTheDocument()
  // Поиск — в колонке оглавления, выровнен по сетке, а не узким полем над всем
  expect(within(toc).getByRole('searchbox', { name: 'Поиск по руководству' })).toBeInTheDocument()
  await userEvent.click(within(toc).getByRole('button', { name: /Касса/ }))
  expect(within(reader()).getByRole('heading', { name: 'Касса' })).toBeInTheDocument()
  expect(window.location.hash).toBe('#/help/guide/kassa')
  // Открытая глава раскрыта в оглавлении
  expect(within(toc).getByRole('button', { name: /Касса/ })).toHaveAttribute('aria-expanded', 'true')
  await userEvent.click(within(reader()).getByRole('button', { name: 'Общие расходы: аренда кабинета, коммуналка' }))
  const crumbs = screen.getByRole('navigation', { name: 'Где я' })
  expect(within(crumbs).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Руководство', 'Касса', 'Общие расходы: аренда кабинета, коммуналка'])
  expect(window.location.hash).toBe(`#/help/guide/kassa/${sectionId(CHAPTERS.find((c) => c.id === 'kassa')!.sections.find((s) => s.title.startsWith('Общие расходы'))!)}`)
  await userEvent.click(screen.getByRole('button', { name: '‹ Назад' }))
  expect(back).toHaveBeenCalled()
})

test('«Следующая ›» и «‹ Предыдущая» листают разделы и переходят через границу главы', async () => {
  const chapters = chaptersFor('admin')
  const pages = pagesOf(chapters)
  const kassa = chapters.find((c) => c.id === 'kassa')!
  const last = kassa.sections[kassa.sections.length - 1]!
  window.history.replaceState(null, '', `/#/help/guide/kassa/${sectionId(last)}`)
  renderBook()
  expect(within(reader()).getByRole('heading', { name: last.title })).toBeInTheDocument()
  const next = pages[pageIndex(pages, { chapter: 'kassa', section: sectionId(last) }) + 1]!
  expect(next.section).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: `Следующая: Глава: ${next.chapter.title}` }))
  expect(within(reader()).getByRole('heading', { name: next.chapter.title })).toBeInTheDocument()
  expect(window.location.hash).toBe(`#/help/guide/${next.chapter.id}`)
  await userEvent.click(screen.getByRole('button', { name: `Предыдущая: ${last.title}` }))
  expect(within(reader()).getByRole('heading', { name: last.title })).toBeInTheDocument()
  // У первой страницы книги «Предыдущей» нет
  window.history.replaceState(null, '', '/#/help/guide/nachalo')
  window.dispatchEvent(new HashChangeEvent('hashchange'))
  expect(await screen.findByRole('heading', { name: 'Начало работы' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /^Предыдущая/ })).not.toBeInTheDocument()
})

test('глубокая ссылка и старая ссылка подсказки открывают раздел; последняя глава запоминается', async () => {
  window.history.replaceState(null, '', '/#/help/guide/novaya-zapis')
  const { unmount } = renderBook({ doctorId: 3 })
  expect(within(reader()).getByRole('heading', { name: 'Новая запись' })).toBeInTheDocument()
  // Адрес — в полном виде: глава/раздел
  expect(window.location.hash).toBe('#/help/guide/raspisanie/novaya-zapis')
  expect(within(reader()).getByRole('button', { name: /Видео: как это сделать/ })).toBeInTheDocument()
  unmount()
  // Открыли «Руководство» без адреса — там, где остановились
  window.history.replaceState(null, '', '/#/help/guide')
  renderBook({ doctorId: 3 })
  expect(within(reader()).getByRole('heading', { name: 'Новая запись' })).toBeInTheDocument()
})

test('ссылка на главу не своей роли — «Все главы», а не пустая страница; хранилище недоступно — без памяти', async () => {
  window.history.replaceState(null, '', '/#/help/guide/kassa')
  const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('private') })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('private') })
  renderBook({ assistantOf: [1] })
  expect(within(reader()).getByRole('heading', { name: 'Касса' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Все главы' })).toHaveAttribute('aria-pressed', 'true')
  // Своя роль — глава не для неё: к оглавлению
  await userEvent.click(screen.getByRole('button', { name: 'Для меня' }))
  expect(screen.queryByRole('article')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /^\d+ Касса$/ })).not.toBeInTheDocument()
  spy.mockRestore()
  vi.restoreAllMocks()
})

test('поиск в книге: результаты «Глава › Раздел» с отрывком, нажал — раздел; ничего — «Искать во всех главах»', async () => {
  renderBook({ assistantOf: [1] })
  const search = screen.getByRole('searchbox', { name: 'Поиск по руководству' })
  await userEvent.type(search, 'зарплата проценты')
  expect(screen.getByRole('status')).toHaveTextContent('Ничего не нашли')
  await userEvent.click(screen.getByRole('button', { name: 'Искать во всех главах' }))
  const results = screen.getByRole('region', { name: 'Результаты поиска' })
  const first = within(results).getAllByRole('button')[0]!
  expect(first).toHaveTextContent('Касса › Зарплата: проценты и оклад')
  expect(first.querySelector('mark')).not.toBeNull()
  await userEvent.click(first)
  expect(within(reader()).getByRole('heading', { name: 'Зарплата: проценты и оклад' })).toBeInTheDocument()
  expect(search).toHaveValue('')
})

test('главная на компьютере — не дубль оглавления: «Продолжить чтение» и «С чего начать», без карточек глав', async () => {
  window.localStorage.setItem('tish.guide.last', 'kassa/dolzhniki')
  window.history.replaceState(null, '', '/#/help/guide/kassa/dolzhniki')
  const { container } = renderBook({ admin: true })
  // Открыли с места чтения; «Руководство» в «где я» — на главную
  await userEvent.click(within(screen.getByRole('navigation', { name: 'Где я' })).getByRole('button', { name: 'Руководство' }))
  const cover = screen.getByRole('region', { name: 'Руководство Tish' })
  expect(container.querySelector('.book-cards, .book-card')).toBeNull()
  // Глав нет на главной — они только в оглавлении слева
  expect(within(cover).queryByRole('button', { name: /^\d+ / })).not.toBeInTheDocument()
  const start = within(cover).getByRole('region', { name: 'С чего начать' })
  const picks = within(start).getAllByRole('button')
  expect(picks.length).toBeGreaterThanOrEqual(3)
  expect(picks.length).toBeLessThanOrEqual(5)
  expect(picks[0]).toHaveTextContent('Добавить сотрудника: одна кнопка')
  await userEvent.click(within(cover).getByRole('button', { name: 'Продолжить чтение: Должники' }))
  expect(within(reader()).getByRole('heading', { name: 'Должники' })).toBeInTheDocument()
  // Раздел: «где я» и листалка на месте
  expect(screen.getByRole('navigation', { name: 'Где я' })).toHaveTextContent('Касса')
  expect(screen.getByRole('navigation', { name: 'Листать' })).toBeInTheDocument()
})

test('«С чего начать» — 3–5 разделов для каждой роли (названия разделов не уехали)', () => {
  for (const role of ['admin', 'reception', 'doctor', 'assistant'] as const) {
    const n = startPages(role, chaptersFor(role)).length
    expect(n, role).toBeGreaterThanOrEqual(3)
  }
  // Ни одного пропавшего названия: все пять нашлись
  for (const role of ['admin', 'reception', 'doctor', 'assistant'] as const) expect(startPages(role, CHAPTERS), role).toHaveLength(5)
})
