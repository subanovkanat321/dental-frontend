import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, expect, test, vi } from 'vitest'

import type { Schemas } from '../api/client'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { nameFromText } from './contactText'

type Patient = Schemas['PatientView']

/** Бэкенд: пустой день и поиск пациентов, который запоминает, что искали. */
function backend(found: Patient[] = []) {
  const searched: string[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', () => HttpResponse.json([])),
    http.get('*/api/service-types', () => HttpResponse.json([])),
    http.post('*/api/patients/search', async ({ request }) => {
      searched.push(((await request.json()) as { query: string }).query)
      return HttpResponse.json(found)
    }),
  )
  return searched
}

async function openNew() {
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: '＋ Новая запись' }))
  return screen.getByRole('complementary', { name: 'Новая запись' })
}

function clipboard(readText: () => Promise<string>) {
  Object.defineProperty(navigator, 'clipboard', { value: { readText }, configurable: true })
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard')
  Reflect.deleteProperty(navigator, 'contacts')
  window.history.replaceState(null, '', '/')
})

test('«📋 Вставить номер»: номера нет среди пациентов — «Новый пациент» с именем и номером из буфера', async () => {
  const searched = backend([])
  clipboard(() => Promise.resolve('Айгуль Маратовна\n+996 (555) 12-34-56'))
  const panel = await openNew()
  // Записной книжки нет (iPhone, Telegram) — «Из контактов телефона» не показываем, вставка — есть
  expect(within(panel).queryByRole('button', { name: '📇 Из контактов телефона' })).toBeNull()
  fireEvent.click(within(panel).getByRole('button', { name: '📋 Вставить номер' }))

  expect(await within(panel).findByLabelText('Имя и фамилия')).toHaveValue('Айгуль Маратовна')
  expect(within(panel).getByRole('textbox', { name: 'Телефон' })).toHaveValue('555123456')
  expect(searched).toEqual(['555123456'])
})

test('«📋 Вставить номер»: номер уже у пациента — он и выбран', async () => {
  backend([{ id: 7, fullName: 'Нурлан К.', phone: '996773123456', telegram: false }])
  clipboard(() => Promise.resolve('0773123456'))
  const panel = await openNew()
  fireEvent.click(within(panel).getByRole('button', { name: '📋 Вставить номер' }))

  expect(await within(panel).findByText('Нурлан К.')).toBeInTheDocument()
  expect(within(panel).getByRole('button', { name: 'Другой' })).toBeInTheDocument()
})

test('«📋 Вставить номер»: читать буфер запретили — подсказка, как скопировать номер', async () => {
  backend([])
  clipboard(() => Promise.reject(new DOMException('denied', 'NotAllowedError')))
  const panel = await openNew()
  fireEvent.click(within(panel).getByRole('button', { name: '📋 Вставить номер' }))

  expect(await within(panel).findByRole('status')).toHaveTextContent('Скопируйте номер в Контактах (удерживайте номер → Скопировать) и вставьте в поле.')
})

test('«📋 Вставить номер»: в буфере не номер — так и скажем', async () => {
  backend([])
  clipboard(() => Promise.resolve('привет'))
  const panel = await openNew()
  fireEvent.click(within(panel).getByRole('button', { name: '📋 Вставить номер' }))

  expect(await within(panel).findByRole('status')).toHaveTextContent(/^В буфере нет номера\./)
})

test('вставили номер прямо в поиск — как «Вставить номер»', async () => {
  backend([])
  const panel = await openNew()
  await userEvent.click(within(panel).getByRole('searchbox', { name: 'Найти пациента' }))
  await userEvent.paste('+996 773 12-34-56')

  expect(await within(panel).findByRole('textbox', { name: 'Телефон' })).toHaveValue('773123456')
})

test('Android Chrome: «📇 Из контактов телефона» по-прежнему через записную книжку', async () => {
  const searched = backend([])
  const select = vi.fn(() => Promise.resolve([{ name: ['Бакыт Асанов'], tel: ['+996 700 11-22-33'] }]))
  Object.defineProperty(navigator, 'contacts', { value: { select }, configurable: true })
  const panel = await openNew()
  expect(within(panel).queryByRole('button', { name: '📋 Вставить номер' })).toBeNull()
  await userEvent.click(within(panel).getByRole('button', { name: '📇 Из контактов телефона' }))

  expect(select).toHaveBeenCalledWith(['name', 'tel'])
  expect(await within(panel).findByLabelText('Имя и фамилия')).toHaveValue('Бакыт Асанов')
  expect(within(panel).getByRole('textbox', { name: 'Телефон' })).toHaveValue('700112233')
  expect(searched).toEqual(['700112233'])
})

test('кнопка бота «📅 Записать» (?contact=токен): имя и номер забираем по токену — «Новая запись» с ними', async () => {
  backend([])
  const tokens: string[] = []
  server.use(http.post('*/api/patients/shared-contact', async ({ request }) => {
    tokens.push(((await request.json()) as { token: string }).token)
    return HttpResponse.json({ fullName: 'Айгуль Маратовна', phone: '996555123456' } satisfies Schemas['SharedContactsContact'])
  }))
  window.history.replaceState(null, '', '/?contact=AbCdEfGhIjKlMnOpQrStUv&v=abc')
  renderApp()

  const panel = await screen.findByRole('complementary', { name: 'Новая запись' })
  expect(await within(panel).findByLabelText('Имя и фамилия')).toHaveValue('Айгуль Маратовна')
  expect(within(panel).getByRole('textbox', { name: 'Телефон' })).toHaveValue('555123456')
  expect(tokens).toEqual(['AbCdEfGhIjKlMnOpQrStUv'])
  // Адрес чистый: токен одноразовый, обновление страницы его не повторит
  expect(window.location.search).toBe('')
})

test('токен устарел — сказали, а расписание открылось как обычно', async () => {
  backend([])
  server.use(http.post('*/api/patients/shared-contact', () => HttpResponse.json(
    { title: 'Not Found', status: 404, detail: 'Ссылка устарела — пришлите контакт боту ещё раз' }, { status: 404 })))
  window.history.replaceState(null, '', '/?contact=AbCdEfGhIjKlMnOpQrStUv')
  renderApp()

  expect(await screen.findByText('Ссылка устарела — пришлите контакт боту ещё раз')).toBeInTheDocument()
  await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Новая запись' })).toBeNull())
})

test('имя из скопированного текста: без номера и меток; нет букв — пусто', () => {
  expect(nameFromText('Айгуль Маратовна\n+996 (555) 12-34-56')).toBe('Айгуль Маратовна')
  expect(nameFromText('тел.: 0555 123 456')).toBe('')
  expect(nameFromText('0555123456')).toBe('')
})

test('помощник в боте, «👤 Новый пациент» (?assist=токен): «Новая запись» с именем, без номера', async () => {
  backend([])
  server.use(http.post('*/api/assist/draft', () => HttpResponse.json(
    { kind: 'BOOK', newPatientName: 'Айбек Осмонов', doctorId: 1, durationMinutes: 30, startAt: '2026-11-13T05:00:00Z' } satisfies Schemas['AssistDraft'])))
  window.history.replaceState(null, '', '/?assist=AbCdEfGhIjKlMnOpQrStUv')
  renderApp()

  const panel = await screen.findByRole('complementary', { name: 'Новая запись' })
  expect(await within(panel).findByLabelText('Имя и фамилия')).toHaveValue('Айбек Осмонов')
  expect(within(panel).getByRole('textbox', { name: 'Телефон' })).toHaveValue('')
})

test('помощник в боте, «✏️ Изменить» записи: пациент выбран, время из черновика', async () => {
  backend([])
  server.use(http.post('*/api/assist/draft', () => HttpResponse.json(
    { kind: 'BOOK', patient: { id: 7, fullName: 'Нурлан К.', phone: '996773123456', telegram: false }, doctorId: 1, durationMinutes: 45,
      startAt: '2026-11-13T09:00:00Z' } satisfies Schemas['AssistDraft'])))
  window.history.replaceState(null, '', '/?assist=AbCdEfGhIjKlMnOpQrStUv')
  renderApp()

  const panel = await screen.findByRole('complementary', { name: 'Новая запись' })
  expect(await within(panel).findByText('Нурлан К.')).toBeInTheDocument()
  expect(within(panel).getByText(/15:00/)).toBeInTheDocument()
})
