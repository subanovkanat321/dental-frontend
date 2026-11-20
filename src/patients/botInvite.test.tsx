import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { contactMenu, findSub, me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { coverageText, dayMonth, invitedHint } from '../schedule/botInvite'

/** Вымышленные пациенты и ссылка: бот dental_test_bot, токен — не настоящий. */
const URL_ = 'https://t.me/dental_test_bot?start=inv_AAAAAAAAAAAAAAAAAAAAAA'
const invite: Schemas['PatientInviteControllerBotInvite'] = {
  url: URL_, expiresAt: '2026-12-20T06:00:00Z', guardian: false,
  textRu: `Здравствуйте! Это Стоматология «Тест». Подключитесь к нашему боту в Telegram: ${URL_}`,
  textKy: `Саламатсызбы! Бул — Стоматология «Тест». Telegram’дагы ботубузга кошулуңуз: ${URL_}`,
}

function backend(sent: unknown[], extra: Parameters<typeof server.use> = []) {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/patients/recent', () => HttpResponse.json([{ id: 2, fullName: 'Айгуль Т.', phone: '996700333444', telegram: false }])),
    http.get('*/api/appointments', () => HttpResponse.json([])),
    http.get('*/api/appointments/debts', () => HttpResponse.json([])),
    http.get('*/api/patients/2/notes', () => HttpResponse.json([])),
    http.post('*/api/patients/:id/bot-invite', () => HttpResponse.json(invite)),
    http.post('*/api/patients/:id/bot-invite/sent', async ({ request, params }) => {
      sent.push({ id: Number(params.id), ...(await request.json() as object) })
      return HttpResponse.json({ invitedAt: '2026-11-20T06:00:00Z' } satisfies Schemas['PatientInviteControllerSent'])
    }),
    ...extra,
  )
}

beforeEach(() => {
  window.location.hash = '/patients'
  vi.stubGlobal('open', vi.fn())
})
afterEach(() => {
  window.location.hash = ''
  vi.unstubAllGlobals()
})

test('подписи: «пригласили 20 нояб», «42 % (120 из 285)»', () => {
  expect(dayMonth('2026-11-20T06:00:00Z')).toBe('20 нояб')
  expect(invitedHint('2026-11-20T06:00:00Z')).toBe('пригласили 20 нояб')
  expect(invitedHint(null)).toBeUndefined()
  expect(coverageText({ inBot: 120, total: 285, percent: 42 })).toBe('42 % (120 из 285)')
})

test('карточка пациента без бота: «Связаться» → «Пригласить в Telegram-бот» → кыргызский текст в WhatsApp, отметка', async () => {
  const sent: unknown[] = []
  backend(sent, [
    http.get('*/api/appointments/by-patient/2', () => HttpResponse.json({
      patient: { id: 2, fullName: 'Айгуль Т.', phone: '996700333444', telegram: false, botInvitedAt: '2026-11-18T06:00:00Z' },
      done: 1, noShow: 0, cancelled: 0, upcoming: [], past: [],
    })),
  ])
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('button', { name: 'Айгуль Т.' }))
  const panel = await screen.findByRole('complementary', { name: 'Карточка пациента' })
  expect(await within(panel).findByText(/без бота — WhatsApp · пригласили 18 нояб/)).toBeInTheDocument()
  await user.click(contactMenu(panel)!)
  const item = screen.getByRole('menuitem', { name: /Пригласить в Telegram-бот/ })
  expect(item).toHaveTextContent('пригласили 18 нояб')
  await user.click(item)

  const sheet = await screen.findByRole('dialog', { name: 'Пригласить в Telegram-бот' })
  expect(await within(sheet).findByLabelText('Текст приглашения')).toHaveTextContent('Здравствуйте! Это Стоматология «Тест».')
  expect(sheet).toHaveTextContent('до 20 дек')
  await user.click(within(sheet).getByRole('button', { name: 'Кыргызча' }))
  expect(within(sheet).getByLabelText('Текст приглашения')).toHaveTextContent('Саламатсызбы!')
  await user.click(within(sheet).getByRole('button', { name: '💬 WhatsApp' }))

  const url = decodeURIComponent(String(vi.mocked(window.open).mock.calls[0]?.[0]))
  expect(url).toContain('996700333444')
  expect(url).toContain('Саламатсызбы!')
  expect(url).toContain('start=inv_')
  await waitFor(() => expect(sent).toEqual([{ id: 2, channel: 'WHATSAPP', lang: 'KY' }]))
  expect(await within(sheet).findByRole('status')).toHaveTextContent('Открыли WhatsApp с текстом')
})

test('пациент в боте: в шапке «в боте», пункта приглашения нет', async () => {
  backend([], [
    http.get('*/api/appointments/by-patient/2', () => HttpResponse.json({
      patient: { id: 2, fullName: 'Айгуль Т.', phone: '996700333444', telegram: true },
      done: 1, noShow: 0, cancelled: 0, upcoming: [], past: [],
    })),
  ])
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('button', { name: 'Айгуль Т.' }))
  const panel = await screen.findByRole('complementary', { name: 'Карточка пациента' })
  expect(await within(panel).findByText('в боте')).toBeInTheDocument()
  await user.click(contactMenu(panel)!)
  expect(screen.queryByRole('menuitem', { name: /Пригласить/ })).not.toBeInTheDocument()
})

test('«Пациенты → Без бота»: доля в боте, строки, «Ещё не приглашали», «📲 Пригласить» — скопировать ссылку', async () => {
  const sent: unknown[] = []
  const queries: string[] = []
  const items: Schemas['BotCoverageControllerNoBotRow'][] = [
    { id: 5, fullName: 'Бакыт М.', phone: '996555111222', nextVisit: '2026-11-22T04:00:00Z' },
    { id: 6, fullName: 'Аружан К.', phone: '996700164001', guardianName: 'Гульнара', lastVisit: '2026-10-01T04:00:00Z', invitedAt: '2026-11-19T04:00:00Z' },
  ]
  backend(sent, [
    http.get('*/api/patients/no-bot', ({ request }) => {
      const invited = new URL(request.url).searchParams.get('invited')
      queries.push(String(invited))
      const body: Schemas['BotCoverageControllerNoBot'] = { coverage: { inBot: 120, total: 285, percent: 42 }, items: invited === 'false' ? items.slice(0, 1) : items }
      return HttpResponse.json(body)
    }),
  ])
  const writeText = vi.fn(() => Promise.resolve())
  const user = userEvent.setup()
  // После setup: userEvent ставит свой буфер обмена
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  renderApp()
  await user.click(await findSub('Без бота'))
  const list = await screen.findByRole('list', { name: 'Без бота' })
  const rows = within(list).getAllByRole('listitem')
  expect(rows).toHaveLength(2)
  expect(rows[0]).toHaveTextContent('записан 22 нояб')
  expect(rows[1]).toHaveTextContent('представитель: Гульнара')
  expect(rows[1]).toHaveTextContent('пригласили 19 нояб')
  expect(screen.getByLabelText('Пациенты в боте')).toHaveTextContent('В боте: 42 % (120 из 285)')

  await user.click(within(rows[0]!).getByRole('button', { name: 'Пригласить в бот: Бакыт М.' }))
  const sheet = await screen.findByRole('dialog', { name: 'Пригласить в Telegram-бот' })
  await user.click(await within(sheet).findByRole('button', { name: '📋 Скопировать ссылку' }))
  expect(writeText).toHaveBeenCalledWith(URL_)
  await waitFor(() => expect(sent).toEqual([{ id: 5, channel: 'COPY', lang: 'RU' }]))
  await user.click(within(sheet).getByRole('button', { name: 'Готово' }))

  await user.click(screen.getByRole('checkbox', { name: 'Ещё не приглашали' }))
  await waitFor(() => expect(queries.at(-1)).toBe('false'))
  await waitFor(() => expect(within(screen.getByRole('list', { name: 'Без бота' })).getAllByRole('listitem')).toHaveLength(1))
})

test('«Касса → Аналитика»: плитка «Пациенты в боте» со ссылкой на «Без бота»', async () => {
  window.location.hash = '/cash/analytics'
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/patients/bot-coverage', () => HttpResponse.json({ inBot: 120, total: 285, percent: 42 } satisfies Schemas['BotCoverageControllerCoverage'])),
  )
  renderApp()
  const tile = await screen.findByRole('region', { name: 'Пациенты в боте' })
  expect(tile).toHaveTextContent('42 %')
  expect(tile).toHaveTextContent('(120 из 285)')
  expect(within(tile).getByRole('link', { name: 'Без бота: 165' })).toHaveAttribute('href', '#/patients/nobot')
})
