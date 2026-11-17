import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { createQueryClient } from '../api/queryClient'
import { server } from '../test/server'
import { CODE_MARK_MS, markCodeSent } from './codeMark'
import { SignupPage } from './SignupPage'

/**
 * «Уже есть код из письма?» (/start): встроенный браузер Instagram закрылся вместе с cookie шага — продолжить по почте и
 * коду; после перезагрузки при живой cookie — снова шаг кода; подсказка над формой — только если код недавно отправляли.
 * Клиника, номер и почта — вымышленные.
 */
const INSTAGRAM_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 357.0.0.25.101 (iPhone14,5; iOS 18_1; ru_RU; ru; scale=3.00; 1170x2532; 657445698)'

const WAITING = {
  state: 'waiting', clinicName: 'Стоматолог Айгерим', phoneMasked: '+996 *** **56', emailMasked: 'a***@gmail.com', secondsLeft: 420,
} satisfies Schemas['SignupControllerEmailWaiting']

type Sent = { path: string; body: Record<string, unknown> }

function backend(status: Schemas['SignupControllerEmailWaiting'] = { state: 'none', secondsLeft: 0 }) {
  const sent: Sent[] = []
  let statusCalls = 0
  server.use(
    http.get('*/web/signup', () => HttpResponse.json({ sms: false, telegram: true, email: true } satisfies Schemas['SignupControllerAvailability'])),
    http.get('*/web/signup/telegram/status', () => HttpResponse.json({ state: 'none', secondsLeft: 0 } satisfies Schemas['SignupControllerTelegramStatus'])),
    http.get('*/web/signup/email/status', () => {
      statusCalls++
      return HttpResponse.json(status)
    }),
    http.post('*/web/signup/email/resume', async ({ request }) => {
      const body = await request.json() as Record<string, unknown>
      sent.push({ path: 'resume', body })
      if (body.code === '654321') {
        return HttpResponse.json({ detail: 'Код устарел — заполните форму ещё раз', code: 'code-expired' }, { status: 410 })
      }
      if (body.email !== 'aigerim.test@gmail.com' || body.code !== '123456') {
        return HttpResponse.json({ detail: 'Проверьте поля', errors: [{ field: 'code', message: 'Код не подошёл или устарел' }] }, { status: 422 })
      }
      return HttpResponse.json(WAITING)
    }),
    http.post('*/web/signup', async ({ request }) => {
      sent.push({ path: 'register', body: await request.json() as Record<string, unknown> })
      return HttpResponse.json({ clinicName: 'Стоматолог Айгерим', fullName: 'Айгерим Тестова' } satisfies Schemas['SignupControllerRegistered'])
    }),
    http.post('*/api/me/telegram-connect', () => HttpResponse.json(
      { link: 'https://t.me/tish_test_bot?start=tglink_abc', secondsLeft: 1800 } satisfies Schemas['TelegramConnectControllerConnectStarted'])),
    http.get('*/web/telegram-connect/status', () => HttpResponse.json(
      { state: 'waiting', secondsLeft: 1000 } satisfies Schemas['TelegramConnectControllerConnectStatus'])),
  )
  return { sent, statusCalls: () => statusCalls }
}

function show() {
  const client = createQueryClient({ queries: { retry: false } })
  render(<QueryClientProvider client={client}><SignupPage onDone={vi.fn()} userAgent={INSTAGRAM_IOS} /></QueryClientProvider>)
}

beforeEach(() => localStorage.clear())

test('«Уже есть код из письма?» → почта и код → пароль (клиника и номер маской) → «Что дальше»', async () => {
  const { sent, statusCalls } = backend()
  const user = userEvent.setup()
  show()
  await screen.findByRole('form', { name: 'Регистрация клиники' })
  // Код не отправляли с этого устройства — ни подсказки, ни запроса статуса
  expect(screen.queryByText(/Отправляли код на почту/)).not.toBeInTheDocument()
  expect(statusCalls()).toBe(0)
  await user.click(screen.getByRole('button', { name: 'Уже есть код из письма?' }))

  const resume = await screen.findByRole('form', { name: 'Уже есть код из письма' })
  await user.type(within(resume).getByRole('textbox', { name: 'Почта' }), ' aigerim.test@gmail.com ')
  await user.type(within(resume).getByRole('textbox', { name: 'Код подтверждения' }), '123456')
  await user.click(within(resume).getByRole('button', { name: 'Дальше' }))

  expect(await screen.findByRole('heading', { name: 'Придумайте пароль' })).toBeInTheDocument()
  expect(screen.getByText(/Код подошёл/)).toHaveTextContent('Стоматолог Айгерим, телефон +996 *** **56')
  expect(sent[0]).toEqual({ path: 'resume', body: { email: 'aigerim.test@gmail.com', code: '123456' } })
  const password = screen.getByRole('form', { name: 'Пароль для входа' })
  await user.type(within(password).getByLabelText('Придумайте пароль для входа'), 'Улыбка2026')
  await user.type(within(password).getByLabelText('Повторите пароль'), 'Улыбка2026')
  await user.click(within(password).getByRole('button', { name: 'Создать клинику' }))

  expect(await screen.findByRole('heading', { name: '✅ Клиника создана' })).toBeInTheDocument()
  expect(sent[1]).toEqual({ path: 'register', body: { method: 'EMAIL', code: '123456', password: 'Улыбка2026' } })
})

test('«Уже есть код»: неверный код — «Код не подошёл или устарел»; истёк — «Заполнить форму»', async () => {
  backend()
  const user = userEvent.setup()
  show()
  await user.click(await screen.findByRole('button', { name: 'Уже есть код из письма?' }))
  const resume = await screen.findByRole('form', { name: 'Уже есть код из письма' })
  await user.type(within(resume).getByRole('textbox', { name: 'Почта' }), 'aigerim.test@gmail.com')
  await user.type(within(resume).getByRole('textbox', { name: 'Код подтверждения' }), '111111')
  await user.click(within(resume).getByRole('button', { name: 'Дальше' }))
  expect(await within(resume).findByRole('alert')).toHaveTextContent('Код не подошёл или устарел')

  const codeBox = within(resume).getByRole('textbox', { name: 'Код подтверждения' })
  await user.clear(codeBox)
  await user.type(codeBox, '654321')
  await user.click(within(resume).getByRole('button', { name: 'Дальше' }))
  const gone = await within(resume).findByText(/Код устарел — заполните форму ещё раз/)
  await user.click(within(gone).getByRole('button', { name: 'Заполнить форму' }))
  expect(await screen.findByRole('form', { name: 'Регистрация клиники' })).toBeVisible()
})

test('код недавно отправляли, cookie шага пропала — подсказка над формой ведёт в «Уже есть код»', async () => {
  markCodeSent()
  const { statusCalls } = backend()
  const user = userEvent.setup()
  show()
  const hint = await screen.findByText(/Отправляли код на почту\?/)
  expect(statusCalls()).toBe(1)
  await user.click(within(hint).getByRole('button', { name: '«Уже есть код из письма»' }))
  expect(await screen.findByRole('form', { name: 'Уже есть код из письма' })).toBeInTheDocument()
})

test('код отправляли давно — подсказки нет', async () => {
  markCodeSent(Date.now() - CODE_MARK_MS - 1000)
  const { statusCalls } = backend()
  show()
  await screen.findByRole('form', { name: 'Регистрация клиники' })
  expect(screen.queryByText(/Отправляли код на почту/)).not.toBeInTheDocument()
  expect(statusCalls()).toBe(0)
})

test('перезагрузили страницу, cookie шага жива — снова «Код из письма», без формы', async () => {
  markCodeSent()
  const { sent } = backend(WAITING)
  const user = userEvent.setup()
  show()
  expect(await screen.findByRole('heading', { name: 'Код из письма' })).toBeInTheDocument()
  expect(screen.getByText(/Письмо отправлено на/)).toHaveTextContent('a***@gmail.com')
  expect(screen.getByText(/Нажмите «Не спам»/)).toBeInTheDocument()
  const code = screen.getByRole('form', { name: 'Код из письма' })
  await user.type(within(code).getByRole('textbox', { name: 'Код подтверждения' }), '123456')
  await user.type(within(code).getByLabelText('Придумайте пароль для входа'), 'Улыбка2026')
  await user.type(within(code).getByLabelText('Повторите пароль'), 'Улыбка2026')
  await user.click(within(code).getByRole('button', { name: 'Создать клинику' }))
  expect(await screen.findByRole('heading', { name: '✅ Клиника создана' })).toBeInTheDocument()
  expect(sent.at(-1)).toEqual({ path: 'register', body: { method: 'EMAIL', code: '123456', password: 'Улыбка2026' } })
})
