import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { byHealth, extendPaid, noShowShare } from './health'

beforeEach(() => {
  window.location.hash = '/platform'
  server.use(http.get('*/web/config', () => HttpResponse.json({ botUsername: 'tish_test_bot' })))
})
afterEach(() => {
  window.location.hash = ''
})

const owner = { ...me, owner: true, platform: true }
const clinic = (id: number, name: string, extra: Partial<Schemas['PlatformServiceClinicRow']> = {}) => ({
  id, name, code: `c${id}`, doctors: 2, staff: 1, patients: 30, appointments: 40, done30: 18, noShow30: 2, health: 'OK', billing: { state: 'FREE' }, ...extra,
}) satisfies Schemas['PlatformServiceClinicRow']

function backend(clinics: Schemas['PlatformServiceClinicRow'][]) {
  server.use(
    http.get('*/api/platform/clinics', () => HttpResponse.json(clinics)),
    http.get('*/api/platform/applications', () => HttpResponse.json([])),
    http.get('*/api/platform/agreements/statuses', () => HttpResponse.json({ 1: { acceptedVersion: 2 } })),
    http.get('*/api/platform/pay-requests', () => HttpResponse.json([])),
    http.get('*/api/platform/clinics/:id/agreement', () => HttpResponse.json({ scans: [] })),
    http.get('*/api/platform/clinics/:id/plan', () => HttpResponse.json({
      billing: { state: 'ACTIVE', paidUntil: '2026-11-10', daysLeft: 10 }, doctors: 2, tariff: { name: 'Клиника', monthSom: 3490, yearSom: 34900 }, payments: [],
    } satisfies Schemas['ClinicPaymentsPlan'])),
  )
}

test('здоровье клиник, неявки и продление срока', () => {
  expect(byHealth([clinic(1, 'Б'), clinic(2, 'А', { health: 'ASLEEP' }), clinic(3, 'В', { health: 'NEW' })]).map((c) => c.name)).toEqual(['А', 'В', 'Б'])
  expect(noShowShare(2, 18)).toBe(10)
  expect(noShowShare(0, 0)).toBeNull()
  expect(extendPaid('2026-11-10', 1, '2026-10-31')).toBe('2026-12-10')
  expect(extendPaid('2026-01-31', 1, '2026-01-31')).toBe('2026-02-28')
  expect(extendPaid(undefined, 3, '2026-10-31')).toBe('2027-01-31')
})

test('владелец: клиники таблицей, карточка — отметить оплату и пригласить админа', async () => {
  backend([clinic(1, 'Стоматология «Тест»', { listed: true }), clinic(2, 'Улыбка', { health: 'ASLEEP', listed: false, settingUp: true })])
  let paid: unknown = null
  let invited: unknown = null
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(owner)),
    http.post('*/api/platform/clinics/2/payments', async ({ request }) => {
      paid = await request.json()
      return HttpResponse.json({ billing: { state: 'ACTIVE', paidUntil: '2027-02-10' }, payments: [] })
    }),
    http.post('*/api/platform/clinics/2/admin-invite', async ({ request }) => {
      invited = await request.json()
      return HttpResponse.json({ token: 'adm1' })
    }),
  )
  const user = userEvent.setup()
  renderApp()
  const table = await screen.findByRole('table', { name: 'Клиники' })
  const rows = within(table).getAllByRole('row')
  expect(rows[1]).toHaveTextContent('Улыбка') // «уснувшая» — первой
  expect(rows[2]).toHaveTextContent('v2')
  // Новая клиника ещё настраивается — пациентам не видна
  expect(rows[1]).toHaveTextContent('не видна пациентам')
  expect(rows[2]).not.toHaveTextContent('не видна пациентам')

  await user.click(within(table).getByRole('button', { name: 'Улыбка' }))
  const panel = await screen.findByRole('complementary', { name: 'Клиника на платформе' })
  expect(within(panel).getByLabelText('Видна пациентам')).toHaveTextContent('Настраивается — пациентам не видна')
  await user.click(await within(panel).findByRole('button', { name: '3 мес' }))
  expect(within(panel).getByRole('spinbutton', { name: 'Сумма, сом' })).toHaveValue(10470)
  expect(within(panel).getByText(/Оплачено будет до 10 февр/)).toBeInTheDocument()
  await user.click(within(panel).getByRole('button', { name: 'Отметить оплату' }))
  expect(await within(panel).findByText(/Оплата отмечена/)).toBeInTheDocument()
  expect(paid).toMatchObject({ months: 3, amountSom: 10470 })

  const form = within(panel).getByRole('form', { name: 'Пригласить админа клиники' })
  await user.type(within(form).getByRole('textbox', { name: 'Имя админа' }), 'Айгерим')
  await user.click(within(form).getByRole('button', { name: 'Создать ссылку' }))
  expect(await within(panel).findByRole('link', { name: 'https://t.me/tish_test_bot?start=staff_adm1' })).toBeInTheDocument()
  expect(invited).toEqual({ fullName: 'Айгерим', alsoDoctor: false })
})

test('заявка с /join: одобрить — новая клиника с контактом из заявки, ссылка админу — сразу в его WhatsApp', async () => {
  let clinics = [clinic(1, 'Стоматология «Тест»')]
  backend(clinics)
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(owner)),
    http.get('*/api/platform/clinics', () => HttpResponse.json(clinics)),
    http.get('*/api/platform/applications', () => HttpResponse.json(clinics.length > 1 ? [] : [
      { id: 5, clinicName: 'Дент Плюс', contactName: 'Бакыт', phone: '996700111222', city: 'Ош', solo: true },
    ])),
    http.post('*/api/platform/applications/5/approve', () => {
      clinics = [...clinics, clinic(9, 'Дент Плюс', { health: 'NEW', contactName: 'Бакыт', contactPhone: '996700111222' })]
      return HttpResponse.json({ clinic: clinics[1], contactName: 'Бакыт', phone: '996700111222', solo: true })
    }),
    http.post('*/api/platform/clinics/9/admin-invite', () => HttpResponse.json({ token: 'adm9' })),
  )
  const open = vi.spyOn(window, 'open').mockReturnValue(null)
  const user = userEvent.setup()
  renderApp()
  const card = await screen.findByRole('group', { name: 'Заявка: Дент Плюс' })
  expect(card).toHaveTextContent('частный врач · Ош')
  await user.click(within(card).getByRole('button', { name: 'Одобрить и завести клинику' }))
  const panel = await screen.findByRole('complementary', { name: 'Клиника на платформе' })
  expect(within(panel).getByRole('heading', { name: 'Дент Плюс' })).toBeInTheDocument()
  expect(within(panel).getByRole('textbox', { name: 'Имя админа' })).toHaveValue('Бакыт')
  expect(within(panel).getByRole('checkbox', { name: /частный врач/ })).toBeChecked()
  // Связаться с тем, кто оставил заявку: номер остаётся в карточке клиники
  const contact = within(panel).getByRole('region', { name: 'Контакт из заявки' })
  expect(contact).toHaveTextContent('Бакыт')
  expect(within(contact).getByRole('link', { name: 'Позвонить' })).toHaveAttribute('href', 'tel:+996700111222')
  await user.click(within(panel).getByRole('button', { name: 'Создать ссылку' }))
  await user.click(await within(panel).findByRole('button', { name: 'Отправить в WhatsApp' }))
  const url = String(open.mock.calls.at(-1)?.[0])
  expect(url).toMatch(/^https:\/\/wa\.me\/996700111222\?text=/)
  expect(decodeURIComponent(url)).toContain('https://t.me/tish_test_bot?start=staff_adm9')
  // Клинике без WhatsApp и Telegram — SMS с телефона владельца, тот же текст со ссылкой
  const sms = within(panel).getByRole('link', { name: 'Отправить SMS' }).getAttribute('href')!
  expect(sms).toMatch(/^sms:\+996700111222\?&body=/)
  expect(decodeURIComponent(sms)).toContain('https://t.me/tish_test_bot?start=staff_adm9')
  // В Telegram ссылка sms: молчит — открывается своя страница браузером телефона, номер и текст — во фрагменте
  window.Telegram = { WebApp: { initData: 'query_id=1&hash=abc', openLink: vi.fn() } } as unknown as typeof window.Telegram
  await user.click(within(panel).getByRole('link', { name: 'Отправить SMS' }))
  const opened = String(vi.mocked(window.Telegram!.WebApp!.openLink!).mock.calls[0]?.[0])
  expect(opened).toMatch(/\/call\.html#sms=996700111222&body=/)
  delete window.Telegram
  open.mockRestore()
})

test('менеджер без клиники: только «Платформа», без оплаты и входа в клинику', async () => {
  backend([clinic(1, 'Стоматология «Тест»', { admins: 'Айгуль' })])
  server.use(http.get('*/api/patient/me', () => HttpResponse.json({ doctor: false, platform: true, owner: false, fullName: 'Мира' })))
  const user = userEvent.setup()
  renderApp()
  const nav = await screen.findByRole('navigation', { name: 'Разделы' })
  expect(within(nav).getAllByRole('button').map((b) => b.textContent?.trim())).toEqual(['Платформа'])
  expect(screen.queryByRole('tab', { name: 'Настройки' })).not.toBeInTheDocument()
  await user.click(await screen.findByRole('button', { name: 'Стоматология «Тест»' }))
  const panel = await screen.findByRole('complementary', { name: 'Клиника на платформе' })
  expect(within(panel).queryByRole('button', { name: 'Отметить оплату' })).not.toBeInTheDocument()
  expect(within(panel).queryByRole('button', { name: 'Войти как админ' })).not.toBeInTheDocument()
  // Второго админа в работающую клинику приглашает только владелец
  expect(within(panel).getByText('Айгуль')).toBeInTheDocument()
  expect(within(panel).queryByText('Пригласить ещё одного админа')).not.toBeInTheDocument()
})

test('рассылка клиникам: подтверждение и итог', async () => {
  backend([clinic(1, 'А'), clinic(2, 'Б')])
  let sent: unknown = null
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(owner)),
    http.get('*/api/platform/broadcasts', () => HttpResponse.json([])),
    http.post('*/api/platform/broadcasts', async ({ request }) => {
      sent = await request.json()
      return HttpResponse.json({ id: 1, recipients: 1, delivered: 1 })
    }),
  )
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('tab', { name: 'Сообщение клиникам' }))
  const form = screen.getByRole('form', { name: 'Сообщение клиникам' })
  await user.type(within(form).getByRole('textbox'), 'Плановые работы в субботу')
  await user.click(within(form).getByRole('button', { name: 'Выбрать' }))
  await user.click(await within(form).findByRole('checkbox', { name: 'Б' }))
  await user.click(within(form).getByRole('button', { name: 'Отправить админам' }))
  expect(await within(form).findByText('Отправлено: дошло 1 из 1')).toBeInTheDocument()
  expect(sent).toEqual({ text: 'Плановые работы в субботу', clinicIds: [2] })
})

test('владелец меняет тарифы: год следует за месяцем, акция, сохранение', async () => {
  let sent: Schemas['BillingControllerTariffsRequest'] | null = null
  const tariffs: Schemas['Tariffs'] = {
    pilotMonths: 3,
    tariffs: [
      { code: 'SOLO', name: 'Кабинет', who: '1 врач', maxDoctors: 1, monthSom: 990, yearSom: 9900 },
      { code: 'LARGE', name: 'Клиника', who: 'Все остальные', monthSom: 2490, yearSom: 24900 },
    ],
  }
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(owner)),
    http.get('*/api/platform/clinics', () => HttpResponse.json([])),
    http.get('*/web/tariffs', () => HttpResponse.json(tariffs)),
    http.put('*/api/platform/tariffs', async ({ request }) => {
      sent = (await request.json()) as Schemas['BillingControllerTariffsRequest']
      return HttpResponse.json({ ...tariffs, pilotMonths: sent.pilotMonths })
    }),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('tab', { name: 'Тарифы' }))
  const form = await screen.findByRole('form', { name: 'Тарифы' })
  await user.clear(within(form).getByLabelText('В месяц: Кабинет'))
  await user.type(within(form).getByLabelText('В месяц: Кабинет'), '790')
  expect(within(form).getByLabelText('За год: Кабинет')).toHaveValue(7900)
  expect(within(form).getByLabelText('Врачей: Клиника')).toBeDisabled()
  await user.clear(within(form).getByLabelText(/Бесплатных месяцев/))
  await user.type(within(form).getByLabelText(/Бесплатных месяцев/), '1')
  await user.click(within(form).getByRole('button', { name: 'Сохранить тарифы' }))
  expect(await within(form).findByRole('status')).toHaveTextContent('Тарифы сохранены')
  expect(sent).toEqual({
    pilotMonths: 1,
    tariffs: [
      { code: 'SOLO', name: 'Кабинет', who: '1 врач', maxDoctors: 1, monthSom: 790, yearSom: 7900 },
      { code: 'LARGE', name: 'Клиника', who: 'Все остальные', monthSom: 2490, yearSom: 24900 },
    ],
  })
})

test('владелец: нажать в любом месте строки клиники — карточка, «Войти в клинику» первым', async () => {
  backend([clinic(5, 'Улыбка Вымышленная', { health: 'ASLEEP' })])
  let entered: unknown = null
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(owner)),
    http.post('*/api/platform/clinics/5/enter', async ({ request }) => {
      entered = await request.json()
      return new HttpResponse(null, { status: 204 })
    }),
  )
  const reload = vi.fn()
  vi.stubGlobal('location', { ...window.location, reload })
  const user = userEvent.setup()
  renderApp()
  const table = await screen.findByRole('table')
  // Не на названии, а на ячейке «Врачей» той же строки
  await user.click(within(table).getAllByRole('row')[1]!.querySelectorAll('td')[4]!)
  const panel = await screen.findByRole('complementary', { name: 'Клиника на платформе' })
  expect(within(panel).getAllByRole('heading', { level: 3 })[0]).toHaveTextContent('Войти в клинику')
  await user.click(within(panel).getByRole('button', { name: 'Войти как админ' }))
  await vi.waitFor(() => expect(entered).toEqual({ reception: false }))
  expect(reload).toHaveBeenCalled()
  vi.unstubAllGlobals()
})

test('выгрузка клиники: доступ поддержке не открыт — аварийная выгрузка после подтверждения', async () => {
  backend([clinic(5, 'Улыбка Вымышленная')])
  const sent: unknown[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(owner)),
    http.post('*/api/platform/clinics/5/export', async ({ request }) => {
      const body = await request.json().catch(() => null) as { emergency?: boolean } | null
      sent.push(body)
      return body?.emergency
        ? HttpResponse.json({ patients: 30, filesIncluded: 4 } satisfies Schemas['ExportControllerResult'])
        : HttpResponse.json({ status: 409, code: 'support-access-required', detail: 'Клиника не открыла доступ поддержке' }, { status: 409 })
    }),
  )
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
  const user = userEvent.setup()
  renderApp()
  const table = await screen.findByRole('table')
  await user.click(within(table).getAllByRole('row')[1]!.querySelectorAll('td')[4]!)
  const panel = await screen.findByRole('complementary', { name: 'Клиника на платформе' })
  await user.click(within(panel).getByRole('button', { name: 'Выгрузить данные клиники — в бот' }))
  expect(await within(panel).findByText('Клиника не открыла доступ поддержке')).toBeInTheDocument()
  await user.click(within(panel).getByRole('button', { name: 'Аварийная выгрузка — клиника узнает' }))
  expect(confirm).toHaveBeenCalledWith('Аварийная выгрузка: клиника получит сообщение. Выгрузить?')
  expect(await within(panel).findByText(/Архив в чате с ботом: пациентов 30/)).toBeInTheDocument()
  expect(sent).toEqual([{}, { emergency: true }])
  confirm.mockRestore()
})

test('«Сведения о платформе»: несколько телефонов поддержки и WhatsApp своим номером', async () => {
  let saved: Schemas['PlatformInfoControllerRequest'] | null = null
  const info: Schemas['PlatformInfoInfo'] = { supportTelegram: 'tish_help', supportPhone: '996555000111', supportPhones: ['996555000111'] }
  backend([])
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(owner)),
    http.get('*/api/platform-info', () => HttpResponse.json(info)),
    http.get('*/web/tariffs', () => HttpResponse.json({ pilotMonths: 3, tariffs: [] })),
    http.put('*/api/platform/info', async ({ request }) => {
      saved = await request.json() as Schemas['PlatformInfoControllerRequest']
      return HttpResponse.json({ ...info, supportPhones: ['996555000111', '996700222333'], supportWhatsapp: '996770444555' })
    }),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('tab', { name: 'Настройки' }))
  const form = await screen.findByRole('form', { name: 'Сведения о платформе' })
  expect(within(form).getByRole('textbox', { name: 'Телефон поддержки' })).toHaveValue('555 000 111')
  await user.click(within(form).getByRole('button', { name: '＋ Ещё номер' }))
  await user.type(within(form).getByRole('textbox', { name: 'Телефон поддержки 2' }), '700 222 333')
  await user.type(within(form).getByRole('textbox', { name: 'WhatsApp поддержки' }), '770 444 555')
  await user.click(within(form).getByRole('button', { name: 'Сохранить' }))
  expect(await within(form).findByRole('status')).toHaveTextContent('Сведения о платформе сохранены')
  expect(saved).toMatchObject({ supportPhones: ['+996 555 000 111', '+996 700 222 333'], supportWhatsapp: '+996 770 444 555' })
})
