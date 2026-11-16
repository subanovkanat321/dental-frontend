import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { createQueryClient } from '../api/queryClient'
import { renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { waitForSlow } from '../test/wait'
import { SignupPage } from './SignupPage'

/** Регистрация клиники (/start): клиники, имена и номера — вымышленные. */
type Sent = { path: string; body: Record<string, unknown>; header: string | null }

function backend(ways: Schemas['SignupControllerAvailability'] = { sms: true, telegram: true },
  initial: Schemas['SignupControllerTelegramStatus']['state'] = 'none') {
  const sent: Sent[] = []
  let telegram: Schemas['SignupControllerTelegramStatus']['state'] = initial
  let error: string | undefined
  const push = async (path: string, request: Request) => {
    const body = await request.json() as Record<string, unknown>
    sent.push({ path, body, header: request.headers.get('X-Dental-Web') })
    return body
  }
  server.use(
    http.get('*/web/signup', () => HttpResponse.json(ways satisfies Schemas['SignupControllerAvailability'])),
    http.post('*/web/signup/code', async ({ request }) => {
      const body = await push('code', request)
      if (!body.clinicName) {
        return HttpResponse.json({ detail: 'Проверьте поля', errors: [{ field: 'clinicName', message: 'Название клиники — до 100 символов' }] }, { status: 422 })
      }
      if (String(body.phone).includes('700 000 011')) {
        return HttpResponse.json({ detail: 'Этот номер уже в клинике «Стоматология Тест» — войдите', code: 'phone-in-clinic' }, { status: 409 })
      }
      return HttpResponse.json({ phoneMasked: '+996 *** **56', secondsLeft: 300, resendSeconds: 60 } satisfies Schemas['SignupControllerCodeSent'])
    }),
    http.post('*/web/signup/telegram', async ({ request }) => {
      await push('telegram', request)
      telegram = 'waiting'
      return HttpResponse.json({ link: 'https://t.me/tish_test_bot?start=websignup_abc', secondsLeft: 300 } satisfies Schemas['SignupControllerTelegramStarted'])
    }),
    http.get('*/web/signup/telegram/status', () => HttpResponse.json({ state: telegram, secondsLeft: 200, error } satisfies Schemas['SignupControllerTelegramStatus'])),
    http.post('*/web/signup', async ({ request }) => {
      const body = await push('register', request)
      if (body.method === 'TELEGRAM') {
        // Клиника уже создана в боте — форма не нужна, вход по cookie шага
        return telegram === 'confirmed'
          ? HttpResponse.json({ clinicName: 'Стоматолог Айгерим', fullName: 'Айгерим Тестова' } satisfies Schemas['SignupControllerRegistered'])
          : HttpResponse.json({ detail: 'Проверьте поля', errors: [{ field: 'telegram', message: 'Подтверждение устарело' }] }, { status: 422 })
      }
      if (body.method === 'SMS' && body.code !== '123456') {
        return HttpResponse.json({ detail: 'Проверьте поля', errors: [{ field: 'code', message: 'Код не подошёл или устарел. Запросите новый' }] }, { status: 422 })
      }
      return HttpResponse.json({ clinicName: String(body.clinicName), fullName: String(body.fullName) } satisfies Schemas['SignupControllerRegistered'])
    }),
    http.delete('*/web/signup/pending', () => new HttpResponse(null, { status: 204 })),
  )
  return { sent, confirm: () => { telegram = 'confirmed' }, fail: (why: string) => { telegram = 'failed'; error = why } }
}

function show(onDone = vi.fn()) {
  const client = createQueryClient({ queries: { retry: false } })
  render(<QueryClientProvider client={client}><SignupPage onDone={onDone} /></QueryClientProvider>)
  return onDone
}

async function fill(user: ReturnType<typeof userEvent.setup>, phone = '555 123 456') {
  const form = await screen.findByRole('form', { name: 'Регистрация клиники' })
  await user.type(within(form).getByRole('textbox', { name: 'Название клиники' }), 'Стоматолог Айгерим')
  await user.click(within(form).getByRole('combobox', { name: /Город/ }))
  await user.click(await screen.findByRole('option', { name: 'Ош' }))
  await user.type(within(form).getByRole('textbox', { name: 'Ваше имя' }), 'Айгерим Тестова')
  await user.type(within(form).getByRole('textbox', { name: 'Ваш телефон' }), phone)
  await user.click(within(form).getByRole('checkbox', { name: /Согласен/ }))
  return form
}

test('/start открывается без входа — форма регистрации клиники', async () => {
  backend()
  server.use(http.get('*/api/patient/me', () => HttpResponse.json({ detail: 'Войдите' }, { status: 401 })))
  window.history.replaceState(null, '', '/start')
  renderApp()
  expect(await screen.findByRole('heading', { name: 'Попробовать Tish бесплатно' })).toBeInTheDocument()
  // Срок не обещаем
  expect(screen.queryByText(/дней|месяц/)).not.toBeInTheDocument()
  // Выбора «частный врач / клиника» и галочки «тоже веду приём» нет: кто регистрируется — руководитель и врач
  const form = screen.getByRole('form', { name: 'Регистрация клиники' })
  expect(within(form).queryByRole('button', { name: /частный врач|несколькими врачами/ })).not.toBeInTheDocument()
  expect(within(form).queryByRole('group', { name: 'Кто вы' })).not.toBeInTheDocument()
  expect(within(form).queryByRole('checkbox', { name: /веду приём/ })).not.toBeInTheDocument()
  expect(within(form).getByRole('textbox', { name: 'Название клиники' })).toHaveAccessibleDescription('или ваше имя, если работаете один')
  window.history.replaceState(null, '', '/')
})

test('регистрация по SMS: форма → код и пароль → клиника создана, сразу в CRM', async () => {
  const { sent } = backend()
  const user = userEvent.setup()
  const onDone = show()
  const form = await fill(user)
  await user.click(within(form).getByRole('button', { name: 'Получить код по SMS' }))

  expect(await screen.findByRole('heading', { name: 'Код из SMS' })).toBeInTheDocument()
  expect(screen.getByText(/\+996 \*\*\* \*\*56/)).toBeInTheDocument()
  expect(sent[0]).toEqual({ path: 'code', header: '1', body: {
    clinicName: 'Стоматолог Айгерим', city: 'Ош', fullName: 'Айгерим Тестова', phone: '+996 555 123 456', consent: true,
  } })
  const code = screen.getByRole('form', { name: 'Код из SMS' })
  await user.type(within(code).getByRole('textbox', { name: 'Код подтверждения' }), '000000')
  await user.type(within(code).getByLabelText('Придумайте пароль для входа'), 'Улыбка2026')
  await user.type(within(code).getByLabelText('Повторите пароль'), 'Улыбка2026')
  await user.click(within(code).getByRole('button', { name: 'Создать клинику' }))
  // Неверный код — под полем, клиника не создана
  expect(await within(code).findByText('Код не подошёл или устарел. Запросите новый')).toBeInTheDocument()
  expect(onDone).not.toHaveBeenCalled()

  await user.clear(within(code).getByRole('textbox', { name: 'Код подтверждения' }))
  await user.type(within(code).getByRole('textbox', { name: 'Код подтверждения' }), '123456')
  await user.click(within(code).getByRole('button', { name: 'Создать клинику' }))
  await waitForSlow(() => expect(onDone).toHaveBeenCalledOnce())
  expect(sent.at(-1)).toMatchObject({ path: 'register', body: { method: 'SMS', code: '123456', password: 'Улыбка2026', clinicName: 'Стоматолог Айгерим' } })
})

test('регистрация через Telegram завершается в боте: страница при возврате видит «готово» и входит без формы', async () => {
  const { sent, confirm } = backend()
  const open = vi.spyOn(window, 'open').mockReturnValue(null)
  const user = userEvent.setup()
  const onDone = show()
  const form = await fill(user)
  await user.click(within(form).getByRole('button', { name: 'Подтвердить через Telegram' }))

  expect(await screen.findByRole('heading', { name: 'Подтвердите в Telegram' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Открыть Telegram' })).toHaveAttribute('href', 'https://t.me/tish_test_bot?start=websignup_abc')
  expect(open).toHaveBeenCalledWith('https://t.me/tish_test_bot?start=websignup_abc', '_blank', 'noopener')
  // Врачам из Instagram: возвращаться не обязательно
  expect(screen.getByText(/Можно не возвращаться: всё откроется прямо в Telegram — кнопка «Открыть день»/)).toBeInTheDocument()
  expect(sent[0]).toMatchObject({ path: 'telegram', body: { clinicName: 'Стоматолог Айгерим', fullName: 'Айгерим Тестова' } })
  expect(sent[0]!.body).not.toHaveProperty('solo')
  expect(sent[0]!.body).not.toHaveProperty('doctor')

  confirm()
  await waitForSlow(() => expect(onDone).toHaveBeenCalledOnce(), { timeout: 8000 })
  expect(sent.at(-1)).toEqual({ path: 'register', header: '1', body: { method: 'TELEGRAM' } })
  open.mockRestore()
})

test('ошибки: поле под полем, номер уже в клинике — «Войти»; SMS выключены — только Telegram', async () => {
  backend({ sms: true, telegram: false })
  const user = userEvent.setup()
  show()
  const form = await screen.findByRole('form', { name: 'Регистрация клиники' })
  expect(within(form).getByRole('button', { name: 'Получить код по SMS' })).toBeEnabled()
  expect(within(form).queryByRole('button', { name: 'Подтвердить через Telegram' })).not.toBeInTheDocument()
  await user.click(within(form).getByRole('button', { name: 'Получить код по SMS' }))
  expect(await within(form).findByText('Название клиники — до 100 символов')).toBeInTheDocument()

  await user.type(within(form).getByRole('textbox', { name: 'Название клиники' }), 'Стоматолог Айгерим')
  await user.type(within(form).getByRole('textbox', { name: 'Ваш телефон' }), '700 000 011')
  await user.click(within(form).getByRole('button', { name: 'Получить код по SMS' }))
  const alert = await within(form).findByRole('alert')
  expect(alert).toHaveTextContent('Этот номер уже в клинике «Стоматология Тест» — войдите')
  expect(within(alert).getByRole('link', { name: 'Войти в Tish' })).toHaveAttribute('href', '/login')
})

test('регистрация выключена на сервере — понятное сообщение и путь «помогите подключить»', async () => {
  backend({ sms: false, telegram: false })
  show()
  expect(await screen.findByText(/Регистрация сейчас недоступна/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Оставьте заявку' })).toHaveAttribute('href', '/join#form')
})

test('вернулись из Telegram после «Да, это я» (страница открылась заново) — «Готово — клиника создана» и вход', async () => {
  const { sent } = backend({ sms: true, telegram: true }, 'confirmed')
  server.use(http.post('*/web/signup', async ({ request }) => {
    sent.push({ path: 'register', body: await request.json() as Record<string, unknown>, header: request.headers.get('X-Dental-Web') })
    await new Promise((r) => setTimeout(r, 50))
    return HttpResponse.json({ clinicName: 'Стоматолог Айгерим', fullName: 'Айгерим Тестова' } satisfies Schemas['SignupControllerRegistered'])
  }))
  const onDone = show()
  expect(await screen.findByText('Готово — клиника создана. Входим…')).toBeInTheDocument()
  await waitForSlow(() => expect(onDone).toHaveBeenCalledOnce())
  expect(sent).toEqual([{ path: 'register', header: '1', body: { method: 'TELEGRAM' } }])
})

test('бот не смог создать клинику — причина на странице, форма снова', async () => {
  const { fail } = backend()
  vi.spyOn(window, 'open').mockReturnValue(null)
  const user = userEvent.setup()
  const onDone = show()
  const form = await fill(user)
  await user.click(within(form).getByRole('button', { name: 'Подтвердить через Telegram' }))
  await screen.findByRole('heading', { name: 'Подтвердите в Telegram' })
  fail('Этот номер уже в клинике «Стоматология Тест» — войдите')
  expect(await screen.findByRole('alert', {}, { timeout: 8000 })).toHaveTextContent('Этот номер уже в клинике «Стоматология Тест» — войдите')
  expect(onDone).not.toHaveBeenCalled()
  vi.restoreAllMocks()
})

test('SMS не ушла (503), Telegram есть — кнопку SMS прячем, отправляем в Telegram', async () => {
  backend()
  server.use(http.post('*/web/signup/code', () =>
    HttpResponse.json({ detail: 'SMS не отправилась — попробуйте ещё раз через минуту' }, { status: 503 })))
  const user = userEvent.setup()
  show()
  const form = await fill(user)
  await user.click(within(form).getByRole('button', { name: 'Получить код по SMS' }))
  expect(await within(form).findByRole('alert')).toHaveTextContent('SMS сейчас не отправляются — подтвердите номер через Telegram')
  expect(within(form).queryByRole('button', { name: 'Получить код по SMS' })).not.toBeInTheDocument()
  expect(within(form).getByRole('button', { name: 'Подтвердить через Telegram' })).toBeEnabled()
})
