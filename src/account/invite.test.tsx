import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

/** «🎁 Пригласите коллег» в «Пригласить коллег» (Tish бесплатный): клиники и числа — вымышленные. */
const view = (over: Partial<Schemas['ClinicReferralsView']> = {}): Schemas['ClinicReferralsView'] => ({
  code: 'abc2def', invited: 2, paid: 1, months: 3, waitingMonths: 0, rewardMonths: 3, invitedPilotMonths: 3,
  ambassadorClinics: 3, ambassadorMonths: 12, ambassador: false, maxMonths: 36, ...over,
})

function backend(referral: Schemas['ClinicReferralsView']) {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/platform-info', () => HttpResponse.json({ accessLog: false, accessNotify: false, accessRequiresGrant: false } satisfies Schemas['PlatformInfoInfo'])),
    http.get('*/api/clinic/referral', () => HttpResponse.json(referral)),
  )
}

beforeEach(() => {
  window.location.hash = '/settings/plan'
})
afterEach(() => {
  window.location.hash = ''
})

test('руководитель: своя ссылка, скопировать и WhatsApp с готовым текстом — «Tish бесплатный», без месяцев и оплат', async () => {
  backend(view())
  const open = vi.spyOn(window, 'open').mockReturnValue(null)
  const user = userEvent.setup()
  renderApp()

  const block = await screen.findByRole('region', { name: 'Пригласите коллег' })
  expect(within(block).getByRole('heading', { name: '🎁 Пригласите коллег' })).toBeInTheDocument()
  expect(block).toHaveTextContent('Tish бесплатный и для других клиник')
  expect(block).not.toHaveTextContent(/месяц|оплат|Амбассадор|пилот/)
  const link = `${window.location.origin}/join?ref=abc2def`
  expect(within(block).getByRole('textbox', { name: 'Ссылка-приглашение' })).toHaveValue(link)
  expect(within(block).getByLabelText('Статистика приглашений')).toHaveTextContent('По вашей ссылке подключились: 2 клиники')

  await user.click(within(block).getByRole('button', { name: 'Скопировать ссылку' }))
  expect(await navigator.clipboard.readText()).toBe(link)
  expect(await within(block).findByRole('status')).toHaveTextContent('Ссылка скопирована')

  await user.click(within(block).getByRole('button', { name: 'Отправить в WhatsApp' }))
  const url = new URL(String(open.mock.calls[0]![0]))
  expect(url.origin + url.pathname).toBe('https://wa.me/')
  expect(url.searchParams.get('text')).toContain(link)
  expect(url.searchParams.get('text')).toContain('Tish бесплатный')
  expect(url.searchParams.get('text')).not.toContain('месяц')
  open.mockRestore()
})

test('клиника сама пришла по приглашению — чья ссылка, без даты пилота; никого не пригласили — без статистики', async () => {
  backend(view({ invited: 0, paid: 0, months: 0, referredBy: 'Стоматология Тест', pilotUntil: '2027-02-16' }))
  renderApp()
  const block = await screen.findByRole('region', { name: 'Пригласите коллег' })
  expect(block).toHaveTextContent('Вы пришли по приглашению клиники «Стоматология Тест».')
  expect(block).not.toHaveTextContent(/пилот|2027/)
  expect(within(block).queryByLabelText('Статистика приглашений')).not.toBeInTheDocument()
})

test('нет доступа (не руководитель) — блока нет, остальная страница на месте', async () => {
  backend(view())
  server.use(http.get('*/api/clinic/referral', () => HttpResponse.json({ detail: 'Приглашения клиник видит руководитель' }, { status: 403 })))
  renderApp()
  expect(await screen.findByRole('heading', { name: 'Tish бесплатный 🎉' })).toBeInTheDocument()
  expect(screen.queryByRole('region', { name: 'Пригласите коллег' })).not.toBeInTheDocument()
})
