import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { findSub, me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { phoneFromInput, phoneToInput } from './phone'
import { waitForSlow } from '../test/wait'

const clinic: Schemas['ClinicView'] = {
  brandName: 'Стоматология «Тест»', phones: ['996555123456'], whatsappPhone: '996555123456', code: 'test1', workStart: '09:00:00', workEnd: '18:00:00',
  workDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'], listed: true, independentDoctors: false, separateSupplies: false, settingUp: false, ownHours: false, recallMonths: 6
}

beforeEach(() => {
  window.location.hash = '/clinic/about'
  server.use(
    http.get('*/api/clinic', () => HttpResponse.json(clinic)),
    http.get('*/api/clinic/deposit', () => HttpResponse.json({ mode: 'OFF', hasQr: false } satisfies Schemas['DepositsSettings'])),
    http.get('*/api/service-types', () => HttpResponse.json([])),
  )
})
afterEach(() => {
  window.location.hash = ''
})

test('телефон: местный номер получает +996, полный — как есть', () => {
  expect(phoneFromInput('555 123 456')).toBe('+996 555 123 456')
  expect(phoneFromInput('+7 900 000 00 00')).toBe('+7 900 000 00 00')
  expect(phoneFromInput(' ')).toBe('')
  expect(phoneToInput('996555123456')).toBe('555 123 456')
})

test('админ: сохранить «О клинике» с днями и WhatsApp, предоплата; «чистого листа» здесь нет', async () => {
  let saved: Schemas['ClinicControllerRequest'] | null = null
  let deposit: unknown = null
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.put('*/api/clinic', async ({ request }) => {
      saved = await request.json() as Schemas['ClinicControllerRequest']
      return HttpResponse.json({ ...clinic, ...saved })
    }),
    http.put('*/api/clinic/deposit', async ({ request }) => {
      deposit = await request.json()
      return HttpResponse.json({ mode: 'NEW', amountSom: 1000, hasQr: false } satisfies Schemas['DepositsSettings'])
    }),
  )
  const user = userEvent.setup()
  renderApp()
  const form = await screen.findByRole('form', { name: 'О клинике' })
  expect(within(form).getByRole('link', { name: `${window.location.origin}/c/test1` })).toBeInTheDocument()
  expect(within(form).getByRole('textbox', { name: 'WhatsApp клиники' })).toHaveValue('555 123 456')
  expect(within(form).getByRole('link', { name: `${window.location.origin}/login` })).toBeInTheDocument()
  await user.click(within(form).getByRole('checkbox', { name: /независимо/ }))
  await user.click(within(form).getByRole('button', { name: 'Сохранить' }))
  expect(await within(form).findByRole('status')).toHaveTextContent('«О клинике» сохранено')
  expect(saved).toMatchObject({
    // Часы — из текущих: их меняют в «Часах работы», здесь не затираем
    whatsappPhone: '+996 555 123 456', independentDoctors: true, workStart: '09:00:00', workEnd: '18:00:00',
    workDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'],
  })

  await user.click(screen.getByRole('button', { name: 'Новых пациентов' }))
  await user.type(screen.getByRole('spinbutton', { name: 'Сколько, сом' }), '1000')
  await user.click(screen.getByRole('button', { name: 'Сохранить предоплату' }))
  expect(await screen.findByText('Предоплата сохранена')).toBeInTheDocument()
  expect(deposit).toEqual({ mode: 'NEW', amountSom: 1000, details: '' })

  // «Удалить все записи» переехал в «Данные» — под выгрузку
  expect(screen.queryByRole('button', { name: 'Удалить все записи' })).not.toBeInTheDocument()
})

test('«Страница для Instagram»: «Скопировать» кладёт ссылку в буфер, подсказка ведёт на раздел руководства', async () => {
  server.use(http.get('*/api/patient/me', () => HttpResponse.json({ ...me, admin: true, doctorId: 1 })))
  const user = userEvent.setup()
  renderApp()
  const form = await screen.findByRole('form', { name: 'О клинике' })
  const page = `${window.location.origin}/c/test1`
  expect(within(form).getByText(/Поставьте в Instagram \(Ссылки в профиле\), 2ГИС \(поле «Сайт»\)/)).toBeInTheDocument()
  expect(within(form).getByRole('link', { name: 'Как и куда поставить' })).toHaveAttribute('href', '/guide?from=app#ssylka-na-zapis')
  await user.click(within(form).getByRole('button', { name: 'Скопировать ссылку на страницу записи' }))
  expect(await within(form).findByText('Ссылка на запись скопирована')).toBeInTheDocument()
  expect(await navigator.clipboard.readText()).toBe(page)
})

test('регистратура: «О клинике» только просмотр, без предоплаты и удаления', async () => {
  server.use(http.get('*/api/patient/me', () => HttpResponse.json({ ...me, admin: false, reception: true, doctorId: undefined })))
  renderApp()
  const form = await screen.findByRole('form', { name: 'О клинике' })
  expect(within(form).getByText(/Только просмотр/)).toBeInTheDocument()
  expect(within(form).getByRole('textbox', { name: 'Название для пациентов' })).toBeDisabled()
  expect(within(form).queryByRole('button', { name: 'Сохранить' })).not.toBeInTheDocument()
  expect(screen.queryByText('Предоплата за запись')).not.toBeInTheDocument()
  expect(screen.queryByText('Начать с чистого листа')).not.toBeInTheDocument()
})

test('«Часы работы»: часы клиники с субботой, остальное «О клинике» не стирается; часы врача раскрываются', async () => {
  let saved: Schemas['ClinicControllerRequest'] | null = null
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.put('*/api/clinic', async ({ request }) => {
      saved = await request.json() as Schemas['ClinicControllerRequest']
      return HttpResponse.json({ ...clinic, ...saved })
    }),
    http.get('*/api/doctors/:id/hours', () => HttpResponse.json({ custom: false, days: [] })),
  )
  // Старый адрес «Настройки → Рабочее время» (закладка) ведёт в «Клинику»
  window.location.hash = '/settings/hours'
  const user = userEvent.setup()
  renderApp()
  const form = await screen.findByRole('form', { name: 'Часы клиники' })
  expect(window.location.hash).toBe('#/clinic/hours')
  await user.click(within(form).getByRole('button', { name: 'Суббота' }))
  await user.click(within(form).getByRole('button', { name: 'Сохранить часы клиники' }))
  expect(await within(form).findByText('Часы клиники сохранены')).toBeInTheDocument()
  expect(saved).toMatchObject({ brandName: 'Стоматология «Тест»', phones: ['996555123456'], whatsappPhone: '996555123456', workStart: '09:00', workEnd: '18:00',
    workDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'] })
  // Свой врач раскрыт сразу, коллега — по нажатию
  expect(await screen.findByRole('group', { name: 'Часы работы' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Дастан Т\./ })).toHaveAttribute('aria-expanded', 'false')
  // «Клиника» — раздел меню: пункт — открытой вкладкой «Клиники», «‹ Настройки» нет
  expect(screen.getByRole('navigation', { name: 'Подразделы: Клиника' })).toBeInTheDocument()
  expect(await findSub('Рабочее время')).toHaveAttribute('aria-current', 'page')
  expect(screen.queryByRole('button', { name: '‹ Настройки' })).not.toBeInTheDocument()
})

test('«О клинике»: несколько телефонов (до трёх, по порядку) и WhatsApp другим номером; ошибка номера — под полем', async () => {
  let saved: Schemas['ClinicControllerRequest'] | null = null
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.put('*/api/clinic', async ({ request }) => {
      saved = await request.json() as Schemas['ClinicControllerRequest']
      return saved.phones?.includes('+996 12')
        ? HttpResponse.json({ status: 422, errors: [{ field: 'phones', message: 'Телефон 2: Номер в формате 0555 123 456' }] }, { status: 422 })
        : HttpResponse.json({ ...clinic, ...saved })
    }),
  )
  const user = userEvent.setup()
  renderApp()
  const form = await screen.findByRole('form', { name: 'О клинике' })
  expect(within(form).getByRole('textbox', { name: 'Телефон клиники' })).toHaveValue('555 123 456')
  await user.click(within(form).getByRole('button', { name: '＋ Ещё номер' }))
  await user.type(within(form).getByRole('textbox', { name: 'Телефон клиники 2' }), '12')
  await user.click(within(form).getByRole('button', { name: '＋ Ещё номер' }))
  // Три номера — больше не добавить
  expect(within(form).queryByRole('button', { name: '＋ Ещё номер' })).not.toBeInTheDocument()
  await user.click(within(form).getByRole('button', { name: 'Убрать номер 3' }))
  const whatsapp = within(form).getByRole('textbox', { name: 'WhatsApp клиники' })
  await user.clear(whatsapp)
  await user.type(whatsapp, '700 999 888')
  await user.click(within(form).getByRole('button', { name: 'Сохранить' }))
  expect((await within(form).findAllByText('Телефон 2: Номер в формате 0555 123 456')).length).toBeGreaterThan(0)
  expect(saved).toMatchObject({ phones: ['+996 555 123 456', '+996 12'], whatsappPhone: '+996 700 999 888' })

  const second = within(form).getByRole('textbox', { name: 'Телефон клиники 2' })
  await user.clear(second)
  await user.type(second, '700 111 222')
  await user.click(within(form).getByRole('button', { name: 'Сохранить' }))
  expect(await within(form).findByRole('status')).toHaveTextContent('«О клинике» сохранено')
  expect(saved).toMatchObject({ phones: ['+996 555 123 456', '+996 700 111 222'] })
})

test('«Я → Оформление»: тёмная тема и крупный текст сразу и запоминаются (старый адрес «Настроек» ведёт сюда)', async () => {
  server.use(http.get('*/api/patient/me', () => HttpResponse.json(me)))
  window.location.hash = '/settings/appearance'
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('button', { name: 'Тёмная' }))
  await user.click(screen.getByRole('button', { name: 'Крупный' }))
  expect(document.documentElement.dataset.theme).toBe('dark')
  expect(document.documentElement.dataset.textSize).toBe('large')
  expect(localStorage.getItem('dental.theme')).toBe('dark')
  await user.click(screen.getByRole('button', { name: 'Светлая' }))
  await user.click(screen.getByRole('button', { name: 'Обычный' }))
  expect(document.documentElement.dataset.theme).toBe('light')
  expect(window.location.hash).toBe('#/me/appearance')
})

test('«Работать с компьютера» в Telegram на телефоне: только ссылка и «Скопировать», без встроенного браузера', async () => {
  vi.stubGlobal('Telegram', { WebApp: { initData: 'query_id=test', platform: 'ios', ready() {}, expand() {}, openLink() {} } })
  try {
    server.use(http.get('*/api/patient/me', () => HttpResponse.json(me)))
    renderApp()
    expect(await screen.findByRole('button', { name: 'Скопировать ссылку' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /\/login$/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Открыть в браузере' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Отправить ссылку себе' })).not.toBeInTheDocument()
  } finally {
    vi.unstubAllGlobals()
  }
})

test('«О клинике»: «Сохранить» видно только с правками, ошибка сервера остаётся, уйти с несохранённым — спросим', async () => {
  let puts = 0
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.put('*/api/clinic', () => {
      puts += 1
      return puts === 1
        ? HttpResponse.json({ status: 503, detail: 'Сервер недоступен, попробуйте ещё раз' }, { status: 503 })
        : HttpResponse.json({ ...clinic, address: 'Бишкек, Чуй 1' })
    }),
  )
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  const user = userEvent.setup()
  renderApp()
  const form = await screen.findByRole('form', { name: 'О клинике' })
  // Правок нет — нет и «Сохранить», которое молча ничего бы не сделало
  expect(within(form).queryByRole('button', { name: 'Сохранить' })).not.toBeInTheDocument()
  // «Клиника» — раздел: уходят из пункта по меню слева; без правок — без вопроса
  await user.click(await findSub('Персонал'))
  expect(confirm).not.toHaveBeenCalled()
  expect(window.location.hash).toBe('#/clinic/staff')

  await user.click(await findSub('О клинике'))
  const again = await screen.findByRole('form', { name: 'О клинике' })
  await user.type(within(again).getByRole('textbox', { name: 'Адрес' }), 'Бишкек, Чуй 1')
  expect(within(again).getByText('Есть несохранённые изменения')).toBeInTheDocument()

  // В другой пункт с несохранённым: «Отмена» — остаёмся с введённым
  await user.click(await findSub('Персонал'))
  expect(confirm).toHaveBeenCalledWith('Есть несохранённые изменения — выйти без сохранения?')
  expect(window.location.hash).toBe('#/clinic/about')
  expect(within(again).getByRole('textbox', { name: 'Адрес' })).toHaveValue('Бишкек, Чуй 1')

  await user.click(within(again).getByRole('button', { name: 'Сохранить' }))
  expect(await within(again).findByRole('alert')).toHaveTextContent('Сервер недоступен, попробуйте ещё раз')
  expect(within(again).getByRole('button', { name: 'Сохранить' })).toBeEnabled()

  await user.click(within(again).getByRole('button', { name: 'Сохранить' }))
  expect(await within(again).findByRole('status')).toHaveTextContent('«О клинике» сохранено')
  expect(within(again).queryByRole('alert')).not.toBeInTheDocument()
  expect(within(again).queryByRole('button', { name: 'Сохранить' })).not.toBeInTheDocument()

  // Сохранили — уходим без вопроса
  confirm.mockClear()
  await user.click(await findSub('Персонал'))
  expect(confirm).not.toHaveBeenCalled()
  expect(window.location.hash).toBe('#/clinic/staff')
  confirm.mockRestore()
})

test('«Часы работы» в Telegram: уход в другой пункт «Клиники» с несохранёнными часами спрашивает, Telegram просит подтвердить закрытие', async () => {
  let back: (() => void) | null = null
  const closing = { on: vi.fn(), off: vi.fn() }
  vi.stubGlobal('Telegram', { WebApp: {
    initData: 'query_id=test', platform: 'ios', ready() {}, expand() {},
    BackButton: { show() {}, hide() {}, onClick: (cb: () => void) => { back = cb }, offClick() {} },
    enableClosingConfirmation: closing.on, disableClosingConfirmation: closing.off,
  } })
  const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
  try {
    server.use(
      http.get('*/api/patient/me', () => HttpResponse.json(me)),
      http.get('*/api/doctors/:id/hours', () => HttpResponse.json({ custom: false, days: [] })),
    )
    window.location.hash = '/clinic/hours'
    const user = userEvent.setup()
    renderApp()
    const form = await screen.findByRole('form', { name: 'Часы клиники' })
    expect(within(form).queryByRole('button', { name: 'Сохранить часы клиники' })).not.toBeInTheDocument()
    // «Клиника» — раздел меню, а не пункт «Настроек»: стрелки «назад» Telegram у неё нет
    expect(back).toBeNull()
    await user.click(within(form).getByRole('button', { name: 'Суббота' }))
    expect(within(form).getByRole('button', { name: 'Сохранить часы клиники' })).toBeInTheDocument()
    expect(closing.on).toHaveBeenCalled()

    await user.click(await findSub('Кресла'))
    expect(confirm).toHaveBeenCalledWith('Есть несохранённые изменения — выйти без сохранения?')
    expect(screen.getByRole('form', { name: 'Часы клиники' })).toBeInTheDocument()

    await user.click(await findSub('Кресла'))
    expect(window.location.hash).toBe('#/clinic/chairs')
    await waitForSlow(() => expect(closing.off).toHaveBeenCalled())
  } finally {
    confirm.mockRestore()
    vi.unstubAllGlobals()
  }
})

test('«О клинике»: город подставляется из адреса, пока его не выбрали руками; выбранный уходит на сервер', async () => {
  let saved: Schemas['ClinicControllerRequest'] | null = null
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.put('*/api/clinic', async ({ request }) => {
      saved = await request.json() as Schemas['ClinicControllerRequest']
      return HttpResponse.json({ ...clinic, ...saved })
    }),
  )
  const user = userEvent.setup()
  renderApp()
  const form = await screen.findByRole('form', { name: 'О клинике' })
  const city = within(form).getByRole('combobox', { name: 'Город' })
  expect(city).toHaveTextContent('Не указан')
  const address = within(form).getByRole('textbox', { name: 'Адрес' })
  await user.type(address, 'г. Ош')
  expect(city).toHaveTextContent('Ош')
  // «Ош» → «Ошская»: город был подставлен, а не выбран — снимается
  await user.type(address, 'ская 5')
  expect(city).toHaveTextContent('Не указан')
  await user.click(city)
  await user.click(await screen.findByRole('option', { name: 'Каракол' }))
  await user.clear(address)
  await user.type(address, 'Бишкек, Манаса 1')
  expect(city).toHaveTextContent('Каракол')
  await user.click(within(form).getByRole('button', { name: 'Сохранить' }))
  await waitForSlow(() => expect(saved).toMatchObject({ address: 'Бишкек, Манаса 1', city: 'Каракол' }))
})

test('врач (не руководитель): часы клиники и «О клинике» — только просмотр с подписью; свои часы — меняет; коллег в «Графике» нет', async () => {
  let put = false
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json({ ...me, admin: false, doctorId: 1 })),
    http.put('*/api/clinic', () => {
      put = true
      return HttpResponse.json(clinic)
    }),
    http.get('*/api/doctors/:id/hours', () => HttpResponse.json({ custom: false, days: [] } satisfies Schemas['DoctorHoursView'])),
  )
  window.location.hash = '/clinic/hours'
  renderApp()
  const form = await screen.findByRole('form', { name: 'Часы клиники' })
  expect(within(form).getByRole('button', { name: 'Суббота' })).toBeDisabled()
  expect(within(form).queryByRole('button', { name: 'Сохранить часы клиники' })).not.toBeInTheDocument()
  expect(screen.getByText(/По ним работают все, у кого «как у клиники»\. Цены и часы клиники меняет руководитель/)).toBeInTheDocument()
  // Свои часы — по-прежнему сам (раскрыты сразу); подпись «как у клиники» видна в строке; коллег врач не видит
  expect(await screen.findByRole('group', { name: 'Часы работы' })).toBeInTheDocument()
  expect(await screen.findByText('врач · как у клиники')).toBeInTheDocument()
  expect(screen.queryByText(/Дастан/)).not.toBeInTheDocument()
  expect(put).toBe(false)

  window.location.hash = '/clinic/about'
  window.dispatchEvent(new HashChangeEvent('hashchange'))
  const about = await screen.findByRole('form', { name: 'О клинике' })
  expect(within(about).getByText(/Только просмотр: «О клинике», цены и часы клиники меняет руководитель/)).toBeInTheDocument()
  expect(within(about).getByRole('textbox', { name: 'Название для пациентов' })).toBeDisabled()
})
