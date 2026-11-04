import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import { server } from '../test/server'
import { Call } from './Call'
import { ClinicSite } from './ClinicSite'
import { Directory } from './Directory'
import { Go } from './Go'
import { Join } from './Join'
import type { ClinicPage, DirectoryClinic, Links } from './web'

afterEach(() => {
  window.history.replaceState(null, '', '/')
  localStorage.clear()
})

test('страница клиники: запись в Telegram, WhatsApp, звонок на каждый номер, врачи и цены; кыргызский', async () => {
  window.history.replaceState(null, '', '/c/abc123')
  let asked = ''
  server.use(http.get('*/web/clinic', ({ request }) => {
    asked = new URL(request.url).search
    return HttpResponse.json({
      name: 'Улыбка', address: 'Бишкек, Шевченко 6', phones: ['996555000111', '77012345678'], whatsapp: '996700999888', telegramUrl: 'https://t.me/tish_bot?start=c_abc123',
      doctors: [{ fullName: 'Айгерим Садыкова', about: 'терапевт' }], services: [{ name: 'Чистка', durationMinutes: 60, priceSom: 2000 }],
    } satisfies ClinicPage)
  }))
  const user = userEvent.setup()
  render(<ClinicSite />)
  expect(await screen.findByRole('heading', { name: 'Улыбка' })).toBeInTheDocument()
  expect(asked).toBe('?code=abc123')
  expect(screen.getByRole('link', { name: /Записаться онлайн в Telegram/ })).toHaveAttribute('href', 'https://t.me/tish_bot?start=c_abc123')
  expect(screen.getByRole('link', { name: /Позвонить \+996 555 000 111/ })).toHaveAttribute('href', 'tel:+996555000111')
  expect(screen.getByRole('link', { name: /Позвонить \+7 701 234 56 78/ })).toHaveAttribute('href', 'tel:+77012345678')
  expect(screen.getByRole('link', { name: 'Написать в WhatsApp' })).toHaveAttribute('href', expect.stringMatching(/^https:\/\/wa\.me\/996700999888\?text=/))
  expect(screen.getByText(/от 2\s000 сом/)).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Кыргызча' }))
  expect(screen.getByRole('link', { name: /Telegram аркылуу онлайн жазылуу/ })).toBeInTheDocument()
  expect(screen.getByText(/2\s000 сомдон/)).toBeInTheDocument()
  expect(localStorage.getItem('clinic.lang')).toBe('ky')
})

test('страница клиники с ?promo= из рекламы: код уходит в ссылку бота, кириллица и мусор — нет', async () => {
  server.use(http.get('*/web/clinic', () => HttpResponse.json({
    name: 'Улыбка', telegramUrl: 'https://t.me/tish_bot?start=c_abc123', doctors: [], services: [],
  } satisfies ClinicPage)))
  window.history.replaceState(null, '', '/c/abc123?promo=zuby10')
  const { unmount } = render(<ClinicSite />)
  expect(await screen.findByRole('link', { name: /Записаться онлайн в Telegram/ }))
    .toHaveAttribute('href', 'https://t.me/tish_bot?start=c_abc123-ZUBY10')
  expect(screen.getByText(/Промокод ZUBY10 подставится при записи в боте/)).toBeInTheDocument()
  unmount()

  window.history.replaceState(null, '', '/c/abc123?promo=%D0%9E%D0%A1%D0%95%D0%9D%D0%AC')
  render(<ClinicSite />)
  expect(await screen.findByRole('link', { name: /Записаться онлайн в Telegram/ })).toHaveAttribute('href', 'https://t.me/tish_bot?start=c_abc123')
  expect(screen.queryByText(/подставится/)).toBeNull()
})

test('каталог: поиск по врачу без учёта «ё» и регистра — когда клиник больше пяти', async () => {
  const clinic = (name: string, doctor: string) => ({ name, pageUrl: `/c/${name}`, doctors: [{ fullName: doctor }] } satisfies DirectoryClinic)
  server.use(http.get('*/web/clinics', () => HttpResponse.json([clinic('Улыбка', 'Айгерим'), clinic('Дент', 'Пётр'), clinic('А', 'Б'), clinic('В', 'Г'),
    clinic('Д', 'Е'), clinic('Ж', 'З')])))
  const user = userEvent.setup()
  render(<Directory />)
  await user.type(await screen.findByRole('searchbox', { name: 'Клиника, врач или адрес' }), 'петр')
  expect(screen.getAllByRole('article')).toHaveLength(1)
  expect(screen.getByRole('heading', { name: 'Дент' })).toBeInTheDocument()
  await user.clear(screen.getByRole('searchbox'))
  await user.type(screen.getByRole('searchbox'), 'нет такого')
  expect(screen.getByText('Ничего не нашлось — попробуйте другое слово.')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Показать все клиники' }))
  expect(screen.getAllByRole('article')).toHaveLength(6)
  // Город у всех один (нет) — выбора городов нет
  expect(screen.queryByRole('group', { name: 'Город' })).not.toBeInTheDocument()
})

test('каталог: клиник мало — ни поиска, ни городов; два города — выбор города, он запоминается', async () => {
  const clinic = (name: string, city: string | null, address?: string) => ({ name, city, address, pageUrl: `/c/${name}`, doctors: [] } satisfies DirectoryClinic)
  let list = [clinic('Улыбка', 'Бишкек'), clinic('Дент', 'Бишкек')]
  server.use(http.get('*/web/clinics', () => HttpResponse.json(list)))
  const { unmount } = render(<Directory />)
  expect(await screen.findAllByRole('article')).toHaveLength(2)
  expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
  expect(screen.queryByRole('group', { name: 'Город' })).not.toBeInTheDocument()
  unmount()

  list = [...list, clinic('Ак-Тиш', 'Ош', 'ул. Ленина 1'), clinic('Без города', null)]
  const user = userEvent.setup()
  const second = render(<Directory />)
  const cities = await screen.findByRole('group', { name: 'Город' })
  expect(within(cities).getAllByRole('button').map((b) => b.textContent)).toEqual(['Все города', 'Бишкек 2', 'Ош 1'])
  await user.click(within(cities).getByRole('button', { name: /Ош/ }))
  expect(screen.getAllByRole('article')).toHaveLength(1)
  expect(screen.getByText(/Ош, ул\. Ленина 1/)).toBeInTheDocument()
  expect(localStorage.getItem('clinics.city')).toBe('Ош')
  second.unmount()

  // Вернулся — снова его город; «Все города» — снова все
  render(<Directory />)
  expect(await screen.findAllByRole('article')).toHaveLength(1)
  await user.click(screen.getByRole('button', { name: 'Все города' }))
  expect(screen.getAllByRole('article')).toHaveLength(4)
  expect(localStorage.getItem('clinics.city')).toBeNull()
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
  // Цены пока не показываем — только «первые 3 месяца бесплатно»
  expect(await screen.findByText(/Первые 3 месяца — бесплатно/)).toBeInTheDocument()
  expect(screen.queryByText('Кабинет')).not.toBeInTheDocument()
  expect(screen.queryByText(/1 490 сом/)).not.toBeInTheDocument()
  const form = screen.getByRole('form', { name: 'Заявка клиники' })
  await user.click(within(form).getByRole('button', { name: 'Частный врач' }))
  await user.type(within(form).getByRole('textbox', { name: /Кабинет/ }), 'Стоматолог Айгерим')
  await user.type(within(form).getByRole('textbox', { name: 'Телефон или WhatsApp' }), '555 000 111')
  await user.type(within(form).getByRole('textbox', { name: 'Telegram — по желанию' }), '@aigerim_dent ')
  // Город — из справочника, а не вписать руками
  await user.click(within(form).getByRole('combobox', { name: /Город/ }))
  await user.click(await screen.findByRole('option', { name: 'Ош' }))
  await user.click(within(form).getByRole('button', { name: 'Оставить заявку' }))
  expect(await within(form).findByText('Нужно согласие')).toBeInTheDocument()
  await user.click(within(form).getByRole('checkbox'))
  await user.click(within(form).getByRole('button', { name: 'Оставить заявку' }))
  expect(await screen.findByRole('heading', { name: 'Заявка отправлена' })).toBeInTheDocument()
  expect(bodies[1]).toMatchObject({ clinicName: 'Стоматолог Айгерим', phone: '+996 555 000 111', telegram: '@aigerim_dent', city: 'Ош', solo: true, consent: true, website: '', doctors: null })
})

test('/go: одно действие пациенту, акция ведёт к форме, без «Скачать», контакты из «Сведений о платформе»', async () => {
  server.use(
    http.get('*/web/links', () => HttpResponse.json({
      supportUrl: 'https://t.me/tish_support', supportTelegram: 'tish_support', supportPhones: ['996555000111', '996700222333'],
      supportWhatsapp: '996770444555', botUrl: 'https://t.me/tish_bot',
    } satisfies Links)),
    http.get('*/web/tariffs', () => HttpResponse.json({ pilotMonths: 3, tariffs: [], promo: { title: 'Акция запуска: 3 месяца бесплатно', text: '', points: [] } })),
  )
  render(<Go />)
  // Акция — часть главной кнопки «Подключить», ведёт сразу к форме заявки
  expect(await screen.findByRole('link', { name: /Акция запуска: 3 месяца бесплатно/ })).toHaveAttribute('href', '/join#form')
  const patients = screen.getByRole('region', { name: 'Пациентам' })
  expect(within(patients).getAllByRole('link')).toHaveLength(1)
  expect(within(patients).getByRole('link', { name: /Записаться к стоматологу/ })).toHaveAttribute('href', '/clinics')
  expect(screen.queryByRole('link', { name: /Бот Tish в Telegram/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: /Скачать/ })).not.toBeInTheDocument()
  expect(screen.getByText('Работать можно в Telegram и на сайте — с телефона и компьютера.')).toBeInTheDocument()
  const contacts = screen.getByRole('region', { name: 'Связаться' })
  expect(within(contacts).getByRole('link', { name: 'Написать в WhatsApp' })).toHaveAttribute('href', 'https://wa.me/996770444555')
  expect(within(contacts).getAllByRole('link', { name: /^Позвонить/ }).map((a) => a.getAttribute('href'))).toEqual(['tel:+996555000111', 'tel:+996700222333'])
  expect(within(contacts).getByRole('link', { name: 'Instagram @tish.app.kg' })).toHaveAttribute('href', 'https://www.instagram.com/tish.app.kg/')
})

test('/go и страница клиники: нет WhatsApp — нет и кнопки WhatsApp', async () => {
  server.use(
    http.get('*/web/links', () => HttpResponse.json({ supportPhones: ['996555000111'] } satisfies Links)),
    http.get('*/web/tariffs', () => HttpResponse.json(null, { status: 500 })),
    http.get('*/web/clinic', () => HttpResponse.json({ name: 'Улыбка', phones: ['996555000111'], whatsapp: null, doctors: [], services: [] } satisfies ClinicPage)),
  )
  const go = render(<Go />)
  expect(await screen.findByRole('link', { name: /Позвонить/ })).toHaveAttribute('href', 'tel:+996555000111')
  // Без акции — та же кнопка «Подключить» без плашки
  expect(screen.getByRole('link', { name: /Подключить клинику бесплатно/ })).toHaveAttribute('href', '/join#form')
  expect(screen.queryByRole('link', { name: /WhatsApp/ })).not.toBeInTheDocument()
  go.unmount()

  render(<ClinicSite />)
  expect(await screen.findByRole('link', { name: /Позвонить/ })).toHaveAttribute('href', 'tel:+996555000111')
  expect(screen.queryByRole('link', { name: /WhatsApp/ })).not.toBeInTheDocument()
})

test('«‹ Назад»: пришли с нашей страницы — шаг назад в истории; по ссылке снаружи — на /go', async () => {
  server.use(http.get('*/web/tariffs', () => HttpResponse.json({ pilotMonths: 3, tariffs: [] })))
  const back = vi.spyOn(window.history, 'back').mockImplementation(() => {})
  const user = userEvent.setup()
  const outside = render(<Join />)
  const link = await screen.findByRole('link', { name: /Назад/ })
  expect(link).toHaveAttribute('href', '/go')
  // Открыли из Instagram: referrer чужой — обычная ссылка, history.back не зовём
  vi.spyOn(document, 'referrer', 'get').mockReturnValue('https://l.instagram.com/')
  await user.click(link)
  expect(back).not.toHaveBeenCalled()
  outside.unmount()

  window.history.pushState(null, '', '/join')
  vi.spyOn(document, 'referrer', 'get').mockReturnValue(`${window.location.origin}/go`)
  render(<Join />)
  await user.click(await screen.findByRole('link', { name: /Назад/ }))
  expect(back).toHaveBeenCalledOnce()
  // Внизу /join — без «Скачать приложение»
  expect(screen.queryByRole('link', { name: /Скачать/ })).not.toBeInTheDocument()
  vi.restoreAllMocks()
})

test('звонок: номер из фрагмента адреса', () => {
  window.history.replaceState(null, '', '/call.html#996555000111')
  render(<Call />)
  expect(screen.getByRole('link', { name: 'Позвонить +996 555 000 111' })).toHaveAttribute('href', 'tel:+996555000111')
})

test('SMS из Telegram: номер и текст из фрагмента — «Сообщения» с ними', () => {
  window.history.replaceState(null, '', `/call.html#${new URLSearchParams({ sms: '996700111222', body: 'Айгерим, приглашаю: https://t.me/bot?start=staff_x' })}`)
  render(<Call />)
  const link = screen.getByRole('link', { name: 'Отправить SMS на +996 700 111 222' })
  expect(link.getAttribute('href')).toMatch(/^sms:\+996700111222\?&body=/)
  expect(decodeURIComponent(link.getAttribute('href')!)).toContain('https://t.me/bot?start=staff_x')
})

test('/join из Instagram: подсказка «открыть в браузере» и WhatsApp, поля без автозаполнения', async () => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Linux; Android 14) Instagram 300.0.0.0 Android')
  server.use(
    http.get('*/web/tariffs', () => HttpResponse.json({ pilotMonths: 3, tariffs: [] })),
    http.get('*/web/links', () => HttpResponse.json({ supportPhones: ['996555000111'], supportWhatsapp: '996555000111' } satisfies Links)),
  )
  render(<Join />)
  expect(await screen.findByText(/Открыли из Instagram\?/)).toBeInTheDocument()
  expect(await screen.findByRole('link', { name: 'напишите нам в WhatsApp' })).toHaveAttribute('href', expect.stringMatching(/^https:\/\/wa\.me\/996555000111\?text=/))
  const form = screen.getByRole('form', { name: 'Заявка клиники' })
  expect(within(form).getByRole('textbox', { name: 'Как к вам обращаться' })).toHaveAttribute('autocomplete', 'off')
  vi.restoreAllMocks()
})

test('Instagram: подсказка «⋮ → Открыть в браузере» и запасная ссылка tg:// с тем же start', async () => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone) Instagram 300.0')
  window.history.replaceState(null, '', '/c/abc123')
  server.use(http.get('*/web/clinic', () => HttpResponse.json({
    name: 'Улыбка', telegramUrl: 'https://t.me/tish_bot?start=c_abc123', doctors: [], services: [],
  } satisfies ClinicPage)))
  render(<ClinicSite />)
  expect(await screen.findByText(/Открыть в браузере/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'открыть приложение Telegram' })).toHaveAttribute('href', 'tg://resolve?domain=tish_bot&start=c_abc123')
  vi.restoreAllMocks()
})

test('новая клиника ещё настраивается: «запись скоро» вместо кнопки записи', async () => {
  window.history.replaceState(null, '', '/c/new123')
  server.use(http.get('*/web/clinic', () => HttpResponse.json({
    name: 'Новая', telegramUrl: null, settingUp: true, doctors: [], services: [{ name: 'Осмотр', durationMinutes: 30 }],
  } satisfies ClinicPage)))
  render(<ClinicSite />)
  expect(await screen.findByRole('status')).toHaveTextContent('Клиника ещё настраивается — запись скоро')
  expect(screen.queryByRole('link', { name: /Записаться онлайн/ })).not.toBeInTheDocument()
  expect(screen.queryByText(/Запишитесь онлайн за минуту/)).not.toBeInTheDocument()
})

test('каталог в Instagram: у клиники — «📲 открыть Telegram» по tg://', async () => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 Instagram 300.0')
  server.use(http.get('*/web/clinics', () => HttpResponse.json([
    { name: 'Улыбка', pageUrl: '/c/u', telegramUrl: 'https://t.me/tish_bot?start=c_u', doctors: [] } satisfies DirectoryClinic,
  ])))
  render(<Directory />)
  expect(await screen.findByRole('link', { name: /открыть Telegram/ })).toHaveAttribute('href', 'tg://resolve?domain=tish_bot&start=c_u')
  expect(screen.getByText(/Открыть в браузере/)).toBeInTheDocument()
  vi.restoreAllMocks()
})

test('обычный браузер — без подсказки про Instagram', async () => {
  server.use(http.get('*/web/clinics', () => HttpResponse.json([
    { name: 'Улыбка', pageUrl: '/c/u', telegramUrl: 'https://t.me/tish_bot?start=c_u', doctors: [] } satisfies DirectoryClinic,
  ])))
  render(<Directory />)
  expect(await screen.findByRole('heading', { name: 'Улыбка' })).toBeInTheDocument()
  expect(screen.queryByText(/Открыть в браузере/)).not.toBeInTheDocument()
})
