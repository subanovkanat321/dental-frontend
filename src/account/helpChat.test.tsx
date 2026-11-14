import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, openItem, renderApp } from '../test/fixtures'
import { server } from '../test/server'

type Thread = Schemas['SupportTicketsThread']

const INFO: Schemas['SupportBotInfo'] = { ai: true, dailyLimit: 30, usedToday: 2, maxLength: 1000 }

/** Вымышленная переписка: вопрос сотрудника и ответ бота (или «передал команде»). */
function thread(answer: string, extra: Partial<Schemas['SupportTicketsTicket']> = {}): Thread {
  return {
    ticket: { id: 9, clinicId: 1, kind: 'QUESTION', status: extra.escalated ? 'OPEN' : 'ANSWERED', viaBot: true, escalated: false, ...extra },
    messages: [
      { id: 1, fromPlatform: false, fromBot: false, author: 'Айгерим', text: 'Как принять доплату?', createdAt: '2026-11-02T05:00:00Z', hasImage: false },
      { id: 2, fromPlatform: true, fromBot: true, author: 'Помощник Tish', text: answer, createdAt: '2026-11-02T05:00:05Z', hasImage: false },
    ],
  }
}

beforeEach(() => {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json({ ...me, admin: false })),
    http.get('*/api/support/tickets', () => HttpResponse.json([])),
    http.get('*/api/platform-info', () => HttpResponse.json({})),
  )
})
afterEach(() => {
  window.location.hash = ''
})

async function openChat() {
  const user = userEvent.setup()
  renderApp()
  openItem('help')
  const panel = await screen.findByRole('complementary', { name: 'Помощь' })
  return { user, panel }
}

test('вопрос — ответ бота; предупреждение о данных пациентов и остаток вопросов', async () => {
  let body: unknown = null
  server.use(
    http.get('*/api/support/chat', () => HttpResponse.json(INFO)),
    http.post('*/api/support/chat', async ({ request }) => {
      body = await request.json()
      return HttpResponse.json(thread('Карточка приёма → «Принять доплату».'))
    }),
    http.get('*/api/support/tickets/9', () => HttpResponse.json(thread('Карточка приёма → «Принять доплату».'))),
  )
  const { user, panel } = await openChat()
  expect(within(panel).getByText(/Не пишите имён, телефонов/)).toBeInTheDocument()
  expect(await within(panel).findByText('Осталось сегодня: 28')).toBeInTheDocument()
  await user.type(within(panel).getByRole('textbox', { name: 'Ваш вопрос' }), 'Как принять доплату?')
  await user.click(within(panel).getByRole('button', { name: 'Спросить' }))
  expect(await within(panel).findByText('Карточка приёма → «Принять доплату».')).toBeInTheDocument()
  expect(within(panel).getByText(/🤖 Помощник Tish/)).toBeInTheDocument()
  expect(body).toEqual({ text: 'Как принять доплату?' })
  expect(within(panel).queryByRole('status')).not.toBeInTheDocument()
  // Дальше — в ту же переписку
  expect(within(panel).getByRole('textbox', { name: 'Дописать' })).toBeInTheDocument()
})

test('бот не уверен — вопрос передан команде Tish', async () => {
  const passed = thread('Передал вопрос команде Tish — ответ придёт сюда и в Telegram.', { escalated: true })
  server.use(
    http.get('*/api/support/chat', () => HttpResponse.json(INFO)),
    http.post('*/api/support/chat', () => HttpResponse.json(passed)),
    http.get('*/api/support/tickets/9', () => HttpResponse.json(passed)),
  )
  const { user, panel } = await openChat()
  await user.type(within(panel).getByRole('textbox', { name: 'Ваш вопрос' }), 'Пропала оплата')
  await user.click(within(panel).getByRole('button', { name: 'Спросить' }))
  expect(await within(panel).findByRole('status')).toHaveTextContent('Вопрос передан команде Tish')
})

test('без ключа ИИ — честно пишем, что вопрос сразу уйдёт команде', async () => {
  server.use(http.get('*/api/support/chat', () => HttpResponse.json({ ...INFO, ai: false })))
  const { panel } = await openChat()
  expect(await within(panel).findByRole('note')).toHaveTextContent('Помощник сейчас не отвечает сам')
  expect(within(panel).queryByText(/Осталось сегодня/)).not.toBeInTheDocument()
})

test('ошибка сервера (лимит) — текст ошибки под формой', async () => {
  server.use(
    http.get('*/api/support/chat', () => HttpResponse.json(INFO)),
    http.post('*/api/support/chat', () => HttpResponse.json(
      { status: 409, detail: 'Сегодня вы уже задали 30 вопросов помощнику — продолжим завтра.', code: 'too-many' },
      { status: 409, headers: { 'Content-Type': 'application/problem+json' } },
    )),
  )
  const { user, panel } = await openChat()
  await user.type(within(panel).getByRole('textbox', { name: 'Ваш вопрос' }), 'Ещё вопрос')
  await user.click(within(panel).getByRole('button', { name: 'Спросить' }))
  expect(await within(panel).findByRole('alert')).toHaveTextContent('Сегодня вы уже задали 30 вопросов')
})

test('«Написать в Tish»: кнопка «Спросить помощника»; строка обращения «Помощник: текст» нажимается целиком и открывает чат', async () => {
  server.use(
    http.get('*/api/support/chat', () => HttpResponse.json(INFO)),
    http.get('*/api/clinic', () => HttpResponse.json({})),
    http.get('*/api/support/tickets', () => HttpResponse.json([
      { id: 9, kind: 'QUESTION', status: 'ANSWERED', viaBot: true, escalated: false, preview: 'Как принять доплату?', clinicId: 0 },
    ] satisfies Schemas['SupportTicketsTicket'][])),
    http.get('*/api/support/tickets/9', () => HttpResponse.json(thread('Карточка приёма → «Принять доплату».'))),
  )
  const user = userEvent.setup()
  renderApp()
  openItem('support')
  // «Мои обращения»: «[Помощник] текст вопроса» — без «› ·» и эмодзи; нажимается вся строка, не только ссылка
  const link = await screen.findByRole('button', { name: /^Помощник\s*Как принять доплату\?$/ })
  const row = link.closest('tr')!
  expect(row).toHaveClass('clickable')
  expect(row.cells[0]!.textContent).not.toMatch(/[›·]|💬/u)
  expect(within(row.cells[0]!).getByText('Помощник')).toHaveClass('chip')
  expect(within(row).getByText('есть ответ')).toHaveClass('chip')
  await user.click(row.cells[1]!)
  const panel = await screen.findByRole('complementary', { name: 'Помощь' })
  expect(await within(panel).findByText('Карточка приёма → «Принять доплату».')).toBeInTheDocument()
  // Тот же чат, что из меню «Помощь»: окно поверх экрана, а не панель страницы в рабочей области
  expect(within(screen.getByRole('main')).queryByRole('complementary', { name: 'Помощь' })).not.toBeInTheDocument()
  await user.click(within(panel).getByRole('button', { name: 'Закрыть' }))
  await user.click(screen.getByRole('button', { name: 'Спросить помощника' }))
  const chat = await screen.findByRole('complementary', { name: 'Помощь' })
  expect(within(chat).getByRole('textbox', { name: 'Ваш вопрос' })).toBeInTheDocument()
  expect(within(screen.getByRole('main')).queryByRole('complementary')).not.toBeInTheDocument()
})

test('«Спросить помощника» в «Написать в Tish» открывает тот же чат, что и меню «Помощь» (окно, а не панель страницы)', async () => {
  server.use(
    http.get('*/api/support/chat', () => HttpResponse.json(INFO)),
    http.get('*/api/clinic', () => HttpResponse.json({})),
  )
  const user = userEvent.setup()
  renderApp()
  // Меню «Помощь» → «Спросить помощника»: где окажется чат
  await user.click(await screen.findByRole('button', { name: 'Помощь' }))
  await user.click(within(screen.getByRole('dialog', { name: 'Помощь' })).getByRole('button', { name: /^Спросить помощника/ }))
  const fromMenu = await screen.findByRole('complementary', { name: 'Помощь' })
  const place = fromMenu.parentElement!.className
  await user.click(within(fromMenu).getByRole('button', { name: 'Закрыть' }))

  openItem('support')
  await user.click(await screen.findByRole('button', { name: 'Спросить помощника' }))
  const fromSupport = await screen.findByRole('complementary', { name: 'Помощь' })
  expect(fromSupport.parentElement!.className).toBe(place)
  expect(within(screen.getByRole('main')).queryByRole('complementary', { name: 'Помощь' })).not.toBeInTheDocument()
  expect(within(fromSupport).getByRole('textbox', { name: 'Ваш вопрос' })).toBeInTheDocument()
})

test('по ссылке «Спросить помощника» (#/help/chat, «Памятка») — сразу чат-окно; страница — без пустой колонки справа', async () => {
  server.use(
    http.get('*/api/support/chat', () => HttpResponse.json(INFO)),
    http.get('*/api/clinic', () => HttpResponse.json({})),
  )
  renderApp()
  openItem('help')
  const chat = await screen.findByRole('complementary', { name: 'Помощь' })
  expect(within(screen.getByRole('main')).queryByRole('complementary', { name: 'Помощь' })).not.toBeInTheDocument()
  expect(within(chat).getByRole('textbox', { name: 'Ваш вопрос' })).toBeInTheDocument()
  expect(document.querySelector('.with-panel')).toBeNull()
})
