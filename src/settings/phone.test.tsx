import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { waitForSlow } from '../test/wait'
import { NO_TELEGRAM_PHONE } from './ProfilePage'

type Phone = Schemas['MyPhoneControllerMyPhone']

/** Регистратор, без кресла врача; номер вымышленный. Подтверждения кодом из SMS нет (убрано 2026-11-27). */
function backend(initial: Phone) {
  let state = initial
  let removed = 0
  const smsCalls: string[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json({ ...me, doctorId: undefined, admin: false, reception: true })),
    http.get('*/api/me/phone', () => HttpResponse.json(state)),
    // Прежние адреса SMS-подтверждения — если страница их дёрнет, тест увидит
    http.post('*/api/me/phone/code', () => { smsCalls.push('code'); return new HttpResponse(null, { status: 404 }) }),
    http.put('*/api/me/phone', () => { smsCalls.push('put'); return new HttpResponse(null, { status: 405 }) }),
    http.delete('*/api/me/phone', () => {
      removed++
      state = { ...state, phone: undefined }
      return new HttpResponse(null, { status: 204 })
    }),
    http.get('*/api/appointments', () => HttpResponse.json([])),
  )
  window.location.hash = '/settings/profile'
  return { removed: () => removed, smsCalls }
}

afterEach(() => {
  window.location.hash = ''
})

test('«Мой профиль»: без Telegram — ни «Указать по SMS», ни формы кода; подсказка: номер меняет руководитель', async () => {
  const { smsCalls } = backend({ phoneOnly: false, telegram: false })
  renderApp()
  const section = await screen.findByRole('region', { name: 'Телефон' })
  expect(await within(section).findByText('Телефон не указан.')).toBeInTheDocument()
  expect(within(section).getByText(NO_TELEGRAM_PHONE)).toBeInTheDocument()
  expect(section).not.toHaveTextContent(/SMS/)
  expect(within(section).queryByRole('button', { name: /Указать/ })).not.toBeInTheDocument()
  expect(within(section).queryByRole('button', { name: 'Изменить' })).not.toBeInTheDocument()
  expect(within(section).queryByRole('textbox')).not.toBeInTheDocument()
  expect(smsCalls).toEqual([])
})

test('«Мой профиль»: без Telegram номер — единственный вход: убрать нельзя, меняет руководитель', async () => {
  backend({ phone: '+996700000052', phoneOnly: true, telegram: false })
  renderApp()
  const section = await screen.findByRole('region', { name: 'Телефон' })
  expect(await within(section).findByText('+996 700 000 052')).toBeInTheDocument()
  expect(section).toHaveTextContent('Ваш вход без Telegram — номер и пароль')
  // Убрать нечего: «⋯» нет совсем
  expect(within(section).queryByRole('button', { name: 'Ещё действия с номером' })).not.toBeInTheDocument()
  await userEvent.setup().click(within(section).getByRole('button', { name: 'Подсказка: Номер для входа' }))
  expect(within(section).getByRole('note')).toHaveTextContent('Без Telegram это ваш единственный вход: номер меняет руководитель, убрать его нельзя.')
  expect(within(section).getByRole('note')).toHaveTextContent('код в Telegram или на почту')
})

test('«Подтвердить через Telegram» в Mini App: Telegram отдаёт номер боту — номер появляется без кода', async () => {
  const { smsCalls } = backend({ phoneOnly: false, telegram: true })
  let requested = 0
  window.Telegram = { WebApp: {
    initData: 'signed', ready() {}, expand() {}, isVersionAtLeast: () => true,
    requestContact(callback: (shared: boolean) => void) {
      requested++
      // Бот получил контакт и привязал номер (StaffPhoneShare на сервере)
      server.use(http.get('*/api/me/phone', () => HttpResponse.json({ phone: '+996700000052', phoneOnly: false, telegram: true } satisfies Phone)))
      callback(true)
    },
  } } as unknown as typeof window.Telegram
  const user = userEvent.setup()
  renderApp()
  const section = await screen.findByRole('region', { name: 'Телефон' })
  await user.click(await within(section).findByRole('button', { name: 'Подтвердить через Telegram' }))
  expect(await within(section).findByText('+996 700 000 052', {}, { timeout: 5000 })).toBeInTheDocument()
  expect(requested).toBe(1)
  expect(smsCalls).toEqual([])
  delete window.Telegram
})

test('«Подтвердить через Telegram» на сайте — ссылка на бота с кнопкой «Поделиться номером»', async () => {
  backend({ phoneOnly: false, telegram: true })
  server.use(http.get('*/web/config', () => HttpResponse.json({ botUsername: 'tish_test_bot', passwordLogin: true, telegramCode: true,
    telegramLogin: true, mailCode: false } satisfies Schemas['WebAuthControllerConfig'])))
  const open = vi.spyOn(window, 'open').mockReturnValue(null)
  const user = userEvent.setup()
  renderApp()
  const section = await screen.findByRole('region', { name: 'Телефон' })
  expect(within(section).queryByText(NO_TELEGRAM_PHONE)).not.toBeInTheDocument()
  const button = await within(section).findByRole('button', { name: 'Подтвердить через Telegram' })
  await waitForSlow(async () => {
    await user.click(button)
    expect(open).toHaveBeenCalledWith('https://t.me/tish_test_bot?start=phone', '_blank', 'noopener,noreferrer')
  })
  expect(within(section).getByRole('status')).toHaveTextContent('«📱 Поделиться номером»')
})

test('номер есть, с Telegram: «Взять номер из Telegram» и в «⋯» — «Убрать номер» (с подтверждением)', async () => {
  const { removed } = backend({ phone: '+996700000053', phoneOnly: false, telegram: true })
  server.use(http.get('*/web/config', () => HttpResponse.json({ botUsername: 'tish_test_bot', passwordLogin: true, telegramCode: true,
    telegramLogin: true, mailCode: false } satisfies Schemas['WebAuthControllerConfig'])))
  const open = vi.spyOn(window, 'open').mockReturnValue(null)
  const user = userEvent.setup()
  renderApp()
  const section = await screen.findByRole('region', { name: 'Телефон' })
  expect(await within(section).findByText('+996 700 000 053')).toHaveClass('phone-number')
  // Одна серая строка; длинное пояснение — в «?»
  expect(section).toHaveTextContent('Для входа без Telegram — с паролем')
  expect(within(section).queryByRole('button', { name: 'Изменить' })).not.toBeInTheDocument()
  await waitForSlow(async () => {
    await user.click(within(section).getByRole('button', { name: 'Взять номер из Telegram' }))
    expect(open).toHaveBeenCalledWith('https://t.me/tish_test_bot?start=phone', '_blank', 'noopener,noreferrer')
  })
  const asked = vi.spyOn(window, 'confirm').mockReturnValue(true)
  await user.click(within(section).getByRole('button', { name: 'Ещё действия с номером' }))
  expect(within(section).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Убрать номер'])
  const remove = within(section).getByRole('menuitem', { name: 'Убрать номер' })
  expect(remove).toHaveClass('tone-bad')
  await user.click(remove)
  expect(asked).toHaveBeenCalledWith(expect.stringContaining('Убрать свой телефон?'))
  await waitForSlow(() => expect(removed()).toBe(1))
  expect(await within(section).findByText('Телефон не указан.')).toBeInTheDocument()
})
