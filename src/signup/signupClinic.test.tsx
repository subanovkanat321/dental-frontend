import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { createQueryClient } from '../api/queryClient'
import { chosen } from '../test/select'
import { server } from '../test/server'
import { SignupPage } from './SignupPage'

/** «Найдите свою клинику» на /start: клиники, адреса, имена и номера — вымышленные. */
const CLINICS: Schemas['ClinicLeadsMatch'][] = [
  { id: 41, name: 'Стоматология Дентал Тест', city: 'Ош', address: 'ул. Примерная, 5', alreadyInTish: false },
  { id: 42, name: 'Дентал Подключённая', city: 'Бишкек', address: 'ул. Тестовая, 1', alreadyInTish: true },
]

function backend() {
  const queries: string[] = []
  const sent: Record<string, unknown>[] = []
  server.use(
    http.get('*/web/signup', () => HttpResponse.json({ telegram: true, email: false } satisfies Schemas['SignupControllerAvailability'])),
    http.get('*/web/signup/telegram/status', () => HttpResponse.json({ state: 'none', secondsLeft: 0 } satisfies Schemas['SignupControllerTelegramStatus'])),
    http.get('*/web/signup/clinics', ({ request }) => {
      const q = new URL(request.url).searchParams.get('q') ?? ''
      queries.push(q)
      return HttpResponse.json(q.includes('нет такой') ? [] : CLINICS)
    }),
    http.post('*/web/signup/telegram', async ({ request }) => {
      const body = await request.json() as Record<string, unknown>
      sent.push(body)
      if (body.leadId === 43) {
        return HttpResponse.json({ detail: 'Эта клиника уже в Tish — попросите доступ у руководителя клиники', code: 'lead-in-tish' }, { status: 409 })
      }
      return HttpResponse.json({ link: 'https://t.me/tish_test_bot?start=websignup_abc', secondsLeft: 300 } satisfies Schemas['SignupControllerTelegramStarted'])
    }),
    http.delete('*/web/signup/pending', () => new HttpResponse(null, { status: 204 })),
  )
  return { queries, sent }
}

function show() {
  const client = createQueryClient({ queries: { retry: false } })
  render(<QueryClientProvider client={client}><SignupPage onDone={vi.fn()} /></QueryClientProvider>)
}

async function search(user: ReturnType<typeof userEvent.setup>, text: string) {
  const box = within(await screen.findByRole('region', { name: 'Найдите свою клинику' })).getByRole('searchbox', { name: 'Название или адрес' })
  await user.clear(box)
  await user.type(box, text)
}

async function finishForm(user: ReturnType<typeof userEvent.setup>, form: HTMLElement) {
  await user.type(within(form).getByRole('textbox', { name: 'Ваше имя' }), 'Айгерим Тестова')
  await user.type(within(form).getByRole('textbox', { name: 'Ваш телефон' }), '555 123 456')
  await user.click(within(form).getByRole('checkbox', { name: /Согласен/ }))
  await user.click(within(form).getByRole('button', { name: 'Подтвердить через Telegram' }))
}

beforeEach(() => vi.spyOn(window, 'open').mockReturnValue(null))

test('шаг 1: поиск от 3 букв — клиники из 2ГИС; выбрали — форма заполнена, на сервер — только номер лида и адрес', async () => {
  const { queries, sent } = backend()
  const user = userEvent.setup()
  show()
  // Формы ещё нет — сначала поиск; меньше 3 букв — не ищем
  expect(screen.queryByRole('form', { name: 'Регистрация клиники' })).not.toBeInTheDocument()
  await search(user, 'де')
  expect(screen.getByText('Введите хотя бы 3 буквы — покажем клиники из 2ГИС')).toBeInTheDocument()

  await search(user, 'дентал')
  const list = await screen.findByRole('list', { name: 'Найденные клиники' })
  expect(queries).toEqual(['дентал'])
  // Уже подключённую не выбрать — подсказка про руководителя
  const inTish = within(list).getByLabelText('Дентал Подключённая')
  expect(inTish).toHaveTextContent('Уже в Tish — попросите доступ у руководителя клиники')
  expect(within(list).queryByRole('button', { name: /Дентал Подключённая/ })).not.toBeInTheDocument()
  await user.click(within(list).getByRole('button', { name: /Стоматология Дентал Тест/ }))

  const form = await screen.findByRole('form', { name: 'Регистрация клиники' })
  expect(screen.getByRole('note', { name: 'Ваша клиника' })).toHaveTextContent('Стоматология Дентал Тест')
  expect(within(form).getByRole('textbox', { name: 'Название клиники' })).toHaveValue('Стоматология Дентал Тест')
  expect(chosen(within(form).getByRole('combobox', { name: /Город/ }))).toContain('Ош')
  const address = within(form).getByRole('textbox', { name: 'Адрес' })
  expect(address).toHaveValue('ул. Примерная, 5')
  // Поля можно поправить
  await user.type(address, ', 2 этаж')
  await finishForm(user, form)

  expect(await screen.findByRole('heading', { name: 'Подтвердите в Telegram' })).toBeInTheDocument()
  expect(sent[0]).toMatchObject({ clinicName: 'Стоматология Дентал Тест', city: 'Ош', leadId: 41, address: 'ул. Примерная, 5, 2 этаж' })
  expect(Object.keys(sent[0]!)).not.toContain('link')
})

test('«Не моя клиника» — снова поиск; «Моей клиники нет» — пустая форма без номера лида', async () => {
  const { sent } = backend()
  const user = userEvent.setup()
  show()
  await search(user, 'дентал')
  await user.click(within(await screen.findByRole('list', { name: 'Найденные клиники' })).getByRole('button', { name: /Стоматология Дентал Тест/ }))
  await user.click(await screen.findByRole('button', { name: 'Не моя клиника' }))
  expect(await screen.findByRole('region', { name: 'Найдите свою клинику' })).toBeInTheDocument()
  expect(screen.queryByRole('form', { name: 'Регистрация клиники' })).not.toBeInTheDocument()

  // Ничего не нашли — подсказка и ручное заполнение
  await search(user, 'нет такой')
  expect(await screen.findByText(/Не нашли «нет такой»/)).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Моей клиники нет — заполнить вручную' }))
  const form = await screen.findByRole('form', { name: 'Регистрация клиники' })
  expect(within(form).getByRole('textbox', { name: 'Название клиники' })).toHaveValue('')
  expect(within(form).queryByRole('textbox', { name: 'Адрес' })).not.toBeInTheDocument()
  await user.type(within(form).getByRole('textbox', { name: 'Название клиники' }), 'Стоматолог Айгерим')
  await finishForm(user, form)
  await screen.findByRole('heading', { name: 'Подтвердите в Telegram' })
  expect(sent[0]).toMatchObject({ clinicName: 'Стоматолог Айгерим' })
  expect(sent[0]).not.toHaveProperty('leadId')
  expect(sent[0]).not.toHaveProperty('address')
})

test('клинику успели занять — сообщение сервера и «Выбрать другую»', async () => {
  backend()
  server.use(http.get('*/web/signup/clinics', () => HttpResponse.json([{ ...CLINICS[0]!, id: 43 }] satisfies Schemas['ClinicLeadsMatch'][])))
  const user = userEvent.setup()
  show()
  await search(user, 'дентал')
  await user.click(within(await screen.findByRole('list', { name: 'Найденные клиники' })).getByRole('button', { name: /Стоматология Дентал Тест/ }))
  const form = await screen.findByRole('form', { name: 'Регистрация клиники' })
  await finishForm(user, form)
  const alert = await within(form).findByRole('alert')
  expect(alert).toHaveTextContent('Эта клиника уже в Tish — попросите доступ у руководителя клиники')
  await user.click(within(alert).getByRole('button', { name: 'Выбрать другую' }))
  expect(await screen.findByRole('region', { name: 'Найдите свою клинику' })).toBeInTheDocument()
})

describe('личная ссылка из сообщения клинике: /start?k=…', () => {
  const TOKEN = 'FakeInviteToken_abc123'
  afterEach(() => window.history.replaceState(null, '', '/'))

  function invited(answer: () => Response) {
    const tokens: unknown[] = []
    server.use(http.post('*/web/signup/lead', async ({ request }) => {
      tokens.push(((await request.json()) as { token?: string }).token)
      return answer()
    }))
    return tokens
  }

  test('клиника сразу выбрана и форма заполнена; код — в теле запроса, адрес — без него', async () => {
    const { sent } = backend()
    const tokens = invited(() => HttpResponse.json(CLINICS[0]!))
    window.history.replaceState(null, '', `/start?k=${TOKEN}&from=whatsapp`)
    const user = userEvent.setup()
    show()
    const form = await screen.findByRole('form', { name: 'Регистрация клиники' })
    expect(screen.getByRole('note', { name: 'Ваша клиника' })).toHaveTextContent('Стоматология Дентал Тест')
    expect(within(form).getByRole('textbox', { name: 'Название клиники' })).toHaveValue('Стоматология Дентал Тест')
    expect(within(form).getByRole('textbox', { name: 'Адрес' })).toHaveValue('ул. Примерная, 5')
    expect(tokens).toEqual([TOKEN])
    // Код убрали из адреса (метка канала осталась)
    expect(window.location.pathname + window.location.search).toBe('/start?from=whatsapp')
    await finishForm(user, form)
    await screen.findByRole('heading', { name: 'Подтвердите в Telegram' })
    expect(sent[0]).toMatchObject({ leadId: 41, from: 'whatsapp' })
    expect(JSON.stringify(sent[0])).not.toContain(TOKEN)
  })

  test('«Не моя клиника» — обычный поиск', async () => {
    backend()
    invited(() => HttpResponse.json(CLINICS[0]!))
    window.history.replaceState(null, '', `/start?k=${TOKEN}`)
    const user = userEvent.setup()
    show()
    await user.click(await screen.findByRole('button', { name: 'Не моя клиника' }))
    expect(await screen.findByRole('region', { name: 'Найдите свою клинику' })).toBeInTheDocument()
    expect(screen.queryByRole('form', { name: 'Регистрация клиники' })).not.toBeInTheDocument()
  })

  test('код не найден (404) — обычный поиск, адрес чистый', async () => {
    backend()
    const tokens = invited(() => HttpResponse.json({ detail: 'Ссылка не найдена' }, { status: 404 }))
    window.history.replaceState(null, '', `/start?k=${TOKEN}`)
    show()
    expect(await screen.findByRole('region', { name: 'Найдите свою клинику' })).toBeInTheDocument()
    expect(tokens).toEqual([TOKEN])
    expect(screen.queryByRole('form', { name: 'Регистрация клиники' })).not.toBeInTheDocument()
    expect(window.location.pathname + window.location.search).toBe('/start')
  })

  test('кривой код — сервер не спрашиваем, обычный поиск', async () => {
    backend()
    const tokens = invited(() => HttpResponse.json(CLINICS[1]!))
    window.history.replaceState(null, '', '/start?k=short')
    show()
    expect(await screen.findByRole('region', { name: 'Найдите свою клинику' })).toBeInTheDocument()
    expect(tokens).toEqual([])
    expect(window.location.search).toBe('')
  })

  test('клиника по ссылке уже в Tish — «попросите доступ», форма не открывается', async () => {
    backend()
    invited(() => HttpResponse.json(CLINICS[1]!))
    window.history.replaceState(null, '', `/start?k=${TOKEN}`)
    show()
    expect(await screen.findByText(/«Дентал Подключённая» уже в Tish — попросите доступ у руководителя клиники/)).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Найдите свою клинику' })).toBeInTheDocument()
    expect(screen.queryByRole('form', { name: 'Регистрация клиники' })).not.toBeInTheDocument()
  })
})
