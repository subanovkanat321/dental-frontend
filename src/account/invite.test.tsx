import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

/** «🎁 Пригласите коллег» в «Тарифе и оплате»: клиники и числа — вымышленные. */
const view = (over: Partial<Schemas['ClinicReferralsView']> = {}): Schemas['ClinicReferralsView'] => ({
  code: 'abc2def', invited: 2, paid: 1, months: 3, waitingMonths: 0, rewardMonths: 3, invitedPilotMonths: 3,
  ambassadorClinics: 3, ambassadorMonths: 12, ambassador: false, maxMonths: 36, ...over,
})

function backend(referral: Schemas['ClinicReferralsView']) {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/platform-info', () => HttpResponse.json({ accessLog: false, accessNotify: false, accessRequiresGrant: false } satisfies Schemas['PlatformInfoInfo'])),
    http.get('*/api/clinic/plan', () => HttpResponse.json({
      billing: { state: 'FREE' }, doctors: 1, tariff: { code: 'SMALL', name: 'Кабинет', monthSom: 1500, yearSom: 15000 },
      tariffs: { pilotMonths: 1, tariffs: [{ code: 'SMALL', name: 'Кабинет', who: '1 врач', monthSom: 1500, yearSom: 15000 }] }, payments: [],
    } satisfies Schemas['ClinicPaymentsPlan'])),
    http.get('*/api/clinic/pay', () => HttpResponse.json({ periods: [{ months: 1, amountSom: 1500 }] } satisfies Schemas['PayRequestsClinicView'])),
    http.get('*/api/clinic/referral', () => HttpResponse.json(referral)),
  )
}

beforeEach(() => {
  window.location.hash = '/settings/plan'
})
afterEach(() => {
  window.location.hash = ''
})

test('руководитель: своя ссылка, скопировать и WhatsApp с готовым текстом, статистика и прогресс к «Амбассадору»', async () => {
  backend(view())
  const open = vi.spyOn(window, 'open').mockReturnValue(null)
  const user = userEvent.setup()
  renderApp()

  const block = await screen.findByRole('region', { name: 'Пригласите коллег' })
  expect(within(block).getByRole('heading', { name: '🎁 Пригласите коллег' })).toBeInTheDocument()
  expect(block).toHaveTextContent('пробует Tish 3 месяца бесплатно')
  expect(block).toHaveTextContent('вам +3 месяца Tish бесплатно')
  expect(block).toHaveTextContent('3 клиники по вашему приглашению оплатили — ещё год бесплатно 🏆')
  const link = `${window.location.origin}/join?ref=abc2def`
  expect(within(block).getByRole('textbox', { name: 'Ссылка-приглашение' })).toHaveValue(link)
  expect(within(block).getByLabelText('Статистика приглашений')).toHaveTextContent('Вы пригласили: 2 клиники, подключились: 1, получено месяцев: 3')
  expect(within(block).getByText('1 из 3 до года бесплатно')).toBeInTheDocument()

  await user.click(within(block).getByRole('button', { name: 'Скопировать ссылку' }))
  expect(await navigator.clipboard.readText()).toBe(link)
  expect(await within(block).findByRole('status')).toHaveTextContent('Ссылка скопирована')

  await user.click(within(block).getByRole('button', { name: 'Отправить в WhatsApp' }))
  const url = new URL(String(open.mock.calls[0]![0]))
  expect(url.origin + url.pathname).toBe('https://wa.me/')
  expect(url.searchParams.get('text')).toContain(link)
  expect(url.searchParams.get('text')).toContain('3 месяца бесплатно')
  open.mockRestore()
})

test('«Амбассадор» получен, месяцы ждут оплаты; клиника сама пришла по приглашению — до какого числа пилот', async () => {
  backend(view({ invited: 5, paid: 3, months: 21, waitingMonths: 21, ambassador: true, referredBy: 'Стоматология Тест', pilotUntil: '2027-02-16' }))
  renderApp()
  const block = await screen.findByRole('region', { name: 'Пригласите коллег' })
  expect(block).toHaveTextContent('Вы пригласили: 5 клиник, подключились: 3, получено месяцев: 21')
  expect(block).toHaveTextContent('🏆 Бонус «Амбассадор» получен — год Tish бесплатно')
  expect(within(block).queryByText(/из 3 до года/)).not.toBeInTheDocument()
  expect(block).toHaveTextContent('21 месяц добавятся к сроку, когда начнёте оплачивать Tish.')
  expect(block).toHaveTextContent('Вы пришли по приглашению клиники «Стоматология Тест» — пилот бесплатно до 16 февр 2027')
})

test('нет доступа (не руководитель) — блока нет, остальная страница на месте', async () => {
  backend(view())
  server.use(http.get('*/api/clinic/referral', () => HttpResponse.json({ detail: 'Приглашения клиник видит руководитель' }, { status: 403 })))
  renderApp()
  expect(await screen.findByRole('heading', { name: 'Тарифы' })).toBeInTheDocument()
  expect(screen.queryByRole('region', { name: 'Пригласите коллег' })).not.toBeInTheDocument()
})
