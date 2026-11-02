import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import { server } from '../test/server'
import { Call } from './Call'
import { ClinicSite } from './ClinicSite'
import { Directory } from './Directory'
import { Go } from './Go'
import { Join } from './Join'
import type { ClinicPage, DirectoryClinic } from './web'

afterEach(() => {
  window.history.replaceState(null, '', '/')
  localStorage.clear()
})

test('страница клиники: запись в Telegram, WhatsApp, звонок, врачи и цены; кыргызский', async () => {
  window.history.replaceState(null, '', '/c/abc123')
  let asked = ''
  server.use(http.get('*/web/clinic', ({ request }) => {
    asked = new URL(request.url).search
    return HttpResponse.json({
      name: 'Улыбка', address: 'Бишкек, Шевченко 6', phone: '996555000111', whatsapp: '996555000111', telegramUrl: 'https://t.me/tish_bot?start=c_abc123',
      doctors: [{ fullName: 'Айгерим Садыкова', about: 'терапевт' }], services: [{ name: 'Чистка', durationMinutes: 60, priceSom: 2000 }],
    } satisfies ClinicPage)
  }))
  const user = userEvent.setup()
  render(<ClinicSite />)
  expect(await screen.findByRole('heading', { name: 'Улыбка' })).toBeInTheDocument()
  expect(asked).toBe('?code=abc123')
  expect(screen.getByRole('link', { name: /Записаться онлайн в Telegram/ })).toHaveAttribute('href', 'https://t.me/tish_bot?start=c_abc123')
  expect(screen.getByRole('link', { name: /Позвонить \+996 555 000 111/ })).toHaveAttribute('href', 'tel:+996555000111')
  expect(screen.getByText(/от 2\s000 сом/)).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Кыргызча' }))
  expect(screen.getByRole('link', { name: /Telegram аркылуу онлайн жазылуу/ })).toBeInTheDocument()
  expect(screen.getByText(/2\s000 сомдон/)).toBeInTheDocument()
  expect(localStorage.getItem('clinic.lang')).toBe('ky')
})

test('каталог: поиск по врачу без учёта «ё» и регистра', async () => {
  const clinic = (name: string, doctor: string) => ({ name, pageUrl: `/c/${name}`, doctors: [{ fullName: doctor }] } satisfies DirectoryClinic)
  server.use(http.get('*/web/clinics', () => HttpResponse.json([clinic('Улыбка', 'Айгерим'), clinic('Дент', 'Пётр'), clinic('А', 'Б'), clinic('В', 'Г')])))
  const user = userEvent.setup()
  render(<Directory />)
  await user.type(await screen.findByRole('searchbox', { name: 'Клиника, врач или адрес' }), 'петр')
  expect(screen.getAllByRole('article')).toHaveLength(1)
  expect(screen.getByRole('heading', { name: 'Дент' })).toBeInTheDocument()
  await user.clear(screen.getByRole('searchbox'))
  await user.type(screen.getByRole('searchbox'), 'нет такого')
  expect(screen.getByText('Ничего не нашлось — попробуйте другое слово.')).toBeInTheDocument()
})

test('заявка клиники: ошибки полей с сервера, потом «Заявка отправлена»', async () => {
  const bodies: Record<string, unknown>[] = []
  server.use(
    http.get('*/web/tariffs', () => HttpResponse.json({ pilotMonths: 3, tariffs: [{ code: 'S', name: 'Кабинет', monthSom: 1490, yearSom: 14900 }] })),
    http.post('*/web/clinic-applications', async ({ request }) => {
      const body = await request.json() as Record<string, unknown>
      bodies.push(body)
      return body.consent
        ? new HttpResponse(null, { status: 201 })
        : HttpResponse.json({ status: 422, errors: [{ field: 'consent', message: 'Нужно согласие' }] }, { status: 422 })
    }),
  )
  const user = userEvent.setup()
  render(<Join />)
  expect(await screen.findByText('Кабинет')).toBeInTheDocument()
  const form = screen.getByRole('form', { name: 'Заявка клиники' })
  await user.click(within(form).getByRole('button', { name: 'Частный врач' }))
  await user.type(within(form).getByRole('textbox', { name: /Кабинет/ }), 'Стоматолог Айгерим')
  await user.type(within(form).getByRole('textbox', { name: 'Телефон или WhatsApp' }), '555 000 111')
  await user.type(within(form).getByRole('textbox', { name: 'Telegram — по желанию' }), '@aigerim_dent ')
  await user.click(within(form).getByRole('button', { name: 'Оставить заявку' }))
  expect(await within(form).findByText('Нужно согласие')).toBeInTheDocument()
  await user.click(within(form).getByRole('checkbox'))
  await user.click(within(form).getByRole('button', { name: 'Оставить заявку' }))
  expect(await screen.findByRole('heading', { name: 'Заявка отправлена' })).toBeInTheDocument()
  expect(bodies[1]).toMatchObject({ clinicName: 'Стоматолог Айгерим', phone: '+996 555 000 111', telegram: '@aigerim_dent', solo: true, consent: true, website: '', doctors: null })
})

test('/go: ссылки пациентам и клиникам, контакты из «Сведений о платформе»', async () => {
  server.use(
    http.get('*/web/links', () => HttpResponse.json({ supportUrl: 'https://t.me/tish_support', supportTelegram: 'tish_support', supportPhone: '996555000111', botUrl: 'https://t.me/tish_bot' })),
    http.get('*/web/tariffs', () => HttpResponse.json(null, { status: 500 })),
  )
  render(<Go />)
  expect(await screen.findByRole('link', { name: /Бот Tish в Telegram/ })).toHaveAttribute('href', 'https://t.me/tish_bot')
  expect(screen.getByRole('link', { name: /Подключить бесплатно/ })).toHaveAttribute('href', '/join#form')
  expect(screen.getByRole('link', { name: /Написать в WhatsApp/ })).toHaveAttribute('href', 'https://wa.me/996555000111')
})

test('звонок: номер из фрагмента адреса', () => {
  window.history.replaceState(null, '', '/call.html#996555000111')
  render(<Call />)
  expect(screen.getByRole('link', { name: 'Позвонить +996 555 000 111' })).toHaveAttribute('href', 'tel:+996555000111')
})

test('/join из Instagram: подсказка «открыть в браузере» и WhatsApp, поля без автозаполнения', async () => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Linux; Android 14) Instagram 300.0.0.0 Android')
  server.use(
    http.get('*/web/tariffs', () => HttpResponse.json({ pilotMonths: 3, tariffs: [] })),
    http.get('*/web/links', () => HttpResponse.json({ supportPhone: '996555000111' })),
  )
  render(<Join />)
  expect(await screen.findByText(/Открыли из Instagram\?/)).toBeInTheDocument()
  expect(await screen.findByRole('link', { name: 'напишите нам в WhatsApp' })).toHaveAttribute('href', expect.stringMatching(/^https:\/\/wa\.me\/996555000111\?text=/))
  const form = screen.getByRole('form', { name: 'Заявка клиники' })
  expect(within(form).getByRole('textbox', { name: 'Как к вам обращаться' })).toHaveAttribute('autocomplete', 'off')
  vi.restoreAllMocks()
})
