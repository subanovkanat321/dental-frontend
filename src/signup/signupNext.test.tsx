import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { createQueryClient } from '../api/queryClient'
import { server } from '../test/server'
import { ConfirmPage } from './ConfirmPage'
import { NextSteps } from './NextSteps'
import { SignupPage } from './SignupPage'

/**
 * Регистрация из встроенного браузера Instagram, по почте и экран «Что дальше». Клиники, имена, номера и почта —
 * вымышленные.
 */
const INSTAGRAM_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 357.0.0.25.101 (iPhone14,5; iOS 18_1; ru_RU; ru; scale=3.00; 1170x2532; 657445698)'
const INSTAGRAM_ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-A546E Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.100 Mobile Safari/537.36 Instagram 352.1.0.41.100 Android (34/14; 450dpi; 1080x2340; samsung; SM-A546E; a54x; s5e8835; ru_RU; 650378389)'
const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'

type Sent = { path: string; body: Record<string, unknown> }

function backend(ways: Schemas['SignupControllerAvailability'] = { sms: true, telegram: true, email: true }) {
  const sent: Sent[] = []
  let connect: Schemas['TelegramConnectControllerConnectStatus']['state'] = 'waiting'
  const push = async (path: string, request: Request) => {
    const body = await request.json() as Record<string, unknown>
    sent.push({ path, body })
    return body
  }
  server.use(
    http.get('*/web/signup', () => HttpResponse.json(ways)),
    http.get('*/web/signup/telegram/status', () => HttpResponse.json({ state: 'none', secondsLeft: 0 } satisfies Schemas['SignupControllerTelegramStatus'])),
    http.post('*/web/signup/email/code', async ({ request }) => {
      await push('email-code', request)
      return HttpResponse.json({ emailMasked: 'a***@gmail.com', secondsLeft: 600, resendSeconds: 60 } satisfies Schemas['SignupControllerEmailSent'])
    }),
    http.post('*/web/signup', async ({ request }) => {
      const body = await push('register', request)
      return HttpResponse.json({ clinicName: String(body.clinicName), fullName: String(body.fullName) } satisfies Schemas['SignupControllerRegistered'])
    }),
    http.post('*/api/me/telegram-connect', () => HttpResponse.json(
      { link: 'https://t.me/tish_test_bot?start=tglink_abc', secondsLeft: 1800 } satisfies Schemas['TelegramConnectControllerConnectStarted'])),
    http.get('*/web/telegram-connect/status', () => HttpResponse.json(
      { state: connect, secondsLeft: 1000 } satisfies Schemas['TelegramConnectControllerConnectStatus'])),
  )
  return { sent, link: () => { connect = 'linked' } }
}

function withClient(ui: React.ReactNode) {
  const client = createQueryClient({ queries: { retry: false } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

async function fill(user: ReturnType<typeof userEvent.setup>) {
  const form = await screen.findByRole('form', { name: 'Регистрация клиники' })
  await user.type(within(form).getByRole('textbox', { name: 'Название клиники' }), 'Стоматолог Айгерим')
  await user.click(within(form).getByRole('combobox', { name: /Город/ }))
  await user.click(await screen.findByRole('option', { name: 'Ош' }))
  await user.type(within(form).getByRole('textbox', { name: 'Ваше имя' }), 'Айгерим Тестова')
  await user.type(within(form).getByRole('textbox', { name: 'Ваш телефон' }), '555 123 456')
  await user.click(within(form).getByRole('checkbox', { name: /Согласен/ }))
  return form
}

test('/start во встроенном браузере Instagram: Telegram главный с подсказкой, SMS и почта — мелкими ссылками', async () => {
  backend()
  withClient(<SignupPage userAgent={INSTAGRAM_IOS} />)
  const form = await screen.findByRole('form', { name: 'Регистрация клиники' })
  expect(within(form).getByRole('button', { name: 'Подтвердить через Telegram' })).toHaveClass('tg-login')
  expect(within(form).getByText('Через Telegram удобнее: Tish останется у вас в Telegram — кнопка «Открыть день»')).toBeInTheDocument()
  expect(within(form).getByRole('button', { name: 'или по SMS' })).toHaveClass('link')
  expect(within(form).queryByRole('button', { name: 'Получить код по SMS' })).not.toBeInTheDocument()
  expect(within(form).getByRole('button', { name: 'или подтвердить по почте' })).toHaveClass('link')
})

test('/start в обычном браузере — без подсказки; почта не настроена — ссылки на почту нет', async () => {
  backend({ sms: true, telegram: true, email: false })
  withClient(<SignupPage userAgent={SAFARI} />)
  const form = await screen.findByRole('form', { name: 'Регистрация клиники' })
  expect(within(form).queryByText(/Через Telegram удобнее/)).not.toBeInTheDocument()
  expect(within(form).getByRole('button', { name: 'Получить код по SMS' })).toBeInTheDocument()
  expect(within(form).queryByRole('button', { name: 'или подтвердить по почте' })).not.toBeInTheDocument()
})

test('по почте: поле «Почта» → письмо → код и пароль здесь же → «Что дальше»', async () => {
  const { sent } = backend({ sms: false, telegram: true, email: true })
  const user = userEvent.setup()
  const onDone = vi.fn()
  withClient(<SignupPage onDone={onDone} userAgent={INSTAGRAM_IOS} />)
  const form = await fill(user)
  expect(within(form).queryByRole('textbox', { name: 'Почта' })).not.toBeInTheDocument()
  await user.click(within(form).getByRole('button', { name: 'или подтвердить по почте' }))
  await user.type(within(form).getByRole('textbox', { name: 'Почта' }), 'aigerim.test@gmail.com')
  await user.click(within(form).getByRole('button', { name: 'Получить письмо' }))

  expect(await screen.findByRole('heading', { name: 'Код из письма' })).toBeInTheDocument()
  expect(screen.getByText(/Письмо отправлено на/)).toHaveTextContent('a***@gmail.com')
  expect(screen.getByText(/Tish откроется в браузере/)).toBeInTheDocument()
  // Gmail выключает ссылки в «Спаме» — подсказка «Не спам» или код; метка «код отправляли» — только время
  expect(screen.getByText(/Письмо в «Спаме»\? Нажмите «Не спам»/)).toBeInTheDocument()
  expect(localStorage.getItem('tish.signup.emailCodeAt')).toMatch(/^\d+$/)
  expect(sent[0]).toEqual({ path: 'email-code', body: {
    clinicName: 'Стоматолог Айгерим', city: 'Ош', fullName: 'Айгерим Тестова', phone: '+996555123456', consent: true,
    email: 'aigerim.test@gmail.com',
  } })
  const code = screen.getByRole('form', { name: 'Код из письма' })
  await user.type(within(code).getByRole('textbox', { name: 'Код подтверждения' }), '123456')
  await user.type(within(code).getByLabelText('Придумайте пароль для входа'), 'Улыбка2026')
  await user.type(within(code).getByLabelText('Повторите пароль'), 'Улыбка2026')
  await user.click(within(code).getByRole('button', { name: 'Создать клинику' }))
  expect(await screen.findByRole('heading', { name: '✅ Клиника создана' })).toBeInTheDocument()
  expect(sent.at(-1)).toMatchObject({ path: 'register', body: { method: 'EMAIL', code: '123456', password: 'Улыбка2026' } })
  expect(onDone).not.toHaveBeenCalled()
  expect(localStorage.getItem('tish.signup.emailCodeAt')).toBeNull()
})

test('«Что дальше» в Instagram на iPhone: предупреждение, ссылка и копирование, «Подключить Telegram», «Перейти в Tish»', async () => {
  const { link } = backend()
  const user = userEvent.setup()
  const onDone = vi.fn()
  withClient(<NextSteps clinicName="Стоматолог Айгерим" onDone={onDone} userAgent={INSTAGRAM_IOS} />)
  expect(screen.getByRole('note')).toHaveTextContent('Вы во встроенном браузере Instagram')
  expect(screen.getByText(/ваш номер и пароль, который вы придумали/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'localhost:3000/login' })).toHaveAttribute('href', '/login')

  await user.click(screen.getByRole('button', { name: 'Скопировать ссылку' }))
  expect(await navigator.clipboard.readText()).toBe(`${window.location.origin}/login`)
  expect(screen.getByText(/Ссылка скопирована/)).toBeInTheDocument()

  // iPhone: Safari программно не открыть — инструкция; Chrome-ссылки нет, «на экран телефона» — тоже
  expect(screen.getByText(/нажмите/)).toHaveTextContent('⋯ вверху справа → «Открыть в браузере»')
  expect(screen.queryByRole('link', { name: 'Открыть в Chrome' })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: /Поставить на экран телефона/ })).not.toBeInTheDocument()

  const telegram = await screen.findByRole('link', { name: '📲 Подключить Telegram' })
  expect(telegram).toHaveAttribute('href', 'https://t.me/tish_test_bot?start=tglink_abc')
  expect(telegram).toHaveAttribute('target', '_blank')
  await user.click(telegram)
  expect(await screen.findByText(/Ждём «✅ Да, это я» в Telegram/)).toBeInTheDocument()
  link()
  expect(await screen.findByText(/Telegram подключён — бот прислал «Открыть день»/, {}, { timeout: 8000 })).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Перейти в Tish' }))
  expect(onDone).toHaveBeenCalledOnce()
})

test('«Что дальше»: Android во встроенном браузере — «Открыть в Chrome», обычный браузер — «Поставить на экран телефона»', async () => {
  backend()
  const { unmount } = withClient(<NextSteps onDone={vi.fn()} userAgent={INSTAGRAM_ANDROID} />)
  expect(screen.getByRole('link', { name: 'Открыть в Chrome' }).getAttribute('href'))
    .toMatch(/^intent:\/\/localhost:3000\/login#Intent;scheme=http;package=com\.android\.chrome;/)
  unmount()
  withClient(<NextSteps onDone={vi.fn()} userAgent={SAFARI} />)
  expect(screen.queryByRole('note')).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: '📲 Поставить на экран телефона' })).toHaveAttribute('href', '/app')
  await screen.findByRole('link', { name: '📲 Подключить Telegram' })
})

test('ссылка из письма: «Почта подтверждена» → пароль → клиника и «Что дальше»; токен ушёл из адреса', async () => {
  const sent: Sent[] = []
  backend()
  server.use(
    http.post('*/web/signup/email/link', async ({ request }) => {
      sent.push({ path: 'link', body: await request.json() as Record<string, unknown> })
      return HttpResponse.json({ clinicName: 'Стоматолог Айгерим', phoneMasked: '+996 *** **56', emailMasked: 'a***@gmail.com' } satisfies Schemas['SignupControllerLinkPreview'])
    }),
    http.post('*/web/signup/email/confirm', async ({ request }) => {
      sent.push({ path: 'confirm', body: await request.json() as Record<string, unknown> })
      return HttpResponse.json({ clinicName: 'Стоматолог Айгерим', fullName: 'Айгерим Тестова' } satisfies Schemas['SignupControllerRegistered'])
    }),
  )
  window.history.replaceState(null, '', '/start/confirm?t=tok_ABCDEFGHIJKLMNOPQRSTUVWX')
  const user = userEvent.setup()
  withClient(<ConfirmPage onDone={vi.fn()} />)
  expect(await screen.findByRole('heading', { name: 'Почта подтверждена' })).toBeInTheDocument()
  expect(window.location.pathname + window.location.search).toBe('/start/confirm')
  expect(screen.getByText(/Стоматолог Айгерим, телефон \+996 \*\*\* \*\*56/)).toBeInTheDocument()
  const form = screen.getByRole('form', { name: 'Пароль для входа' })
  await user.type(within(form).getByLabelText('Придумайте пароль для входа'), 'Улыбка2026')
  await user.type(within(form).getByLabelText('Повторите пароль'), 'Улыбка2026')
  await user.click(within(form).getByRole('button', { name: 'Создать клинику' }))
  expect(await screen.findByRole('heading', { name: '✅ Клиника создана' })).toBeInTheDocument()
  expect(sent).toEqual([
    { path: 'link', body: { token: 'tok_ABCDEFGHIJKLMNOPQRSTUVWX' } },
    { path: 'confirm', body: { token: 'tok_ABCDEFGHIJKLMNOPQRSTUVWX', password: 'Улыбка2026' } },
  ])
  window.history.replaceState(null, '', '/')
})

test('ссылка из письма устарела или уже использована — «Ссылка устарела» и путь на /start', async () => {
  server.use(http.post('*/web/signup/email/link', () =>
    HttpResponse.json({ detail: 'Ссылка устарела — зарегистрируйтесь ещё раз' }, { status: 404 })))
  window.history.replaceState(null, '', '/start/confirm?t=old_ABCDEFGHIJKLMNOPQRSTUVWX')
  withClient(<ConfirmPage />)
  expect(await screen.findByRole('heading', { name: 'Ссылка устарела' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Зарегистрироваться' })).toHaveAttribute('href', '/start')
  window.history.replaceState(null, '', '/')
})
