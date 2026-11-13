import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { readDeepLink } from '../lib/deepLink'
import { me, renderApp, findSub } from '../test/fixtures'
import { choose } from '../test/select'
import { server } from '../test/server'
import { adminsLine, remindedText, statusText } from './agreementTarget'
import { waitForSlow } from '../test/wait'

beforeEach(() => {
  window.location.hash = '/platform'
  server.use(http.get('*/web/config', () => HttpResponse.json({ botUsername: 'tish_test_bot' })))
})
afterEach(() => {
  window.location.hash = ''
})

const owner = { ...me, owner: true, platform: true }
const clinic = (id: number, name: string) => ({
  id, name, code: `c${id}`, doctors: 1, staff: 1, patients: 3, appointments: 4, done30: 4, noShow30: 0, health: 'OK', billing: { state: 'FREE' }, bookedWeek: 0, selfBooked30: 0, unmarked: 0, hidden: false, listed: true, settingUp: false
}) satisfies Schemas['PlatformServiceClinicRow']

const statuses: Record<string, Schemas['AgreementsStatus']> = {
  1: { requiredVersion: 2, signed: true, signedAt: '2026-11-01T06:00:00Z', scans: 0, admins: { telegram: 1, phone: 0, push: 0 }, assigned: false },
  2: { requiredVersion: 3, assigned: true, signed: false, scans: 0, admins: { telegram: 2, phone: 1, push: 1 } },
  3: { scans: 0, admins: { telegram: 0, phone: 0, push: 0 }, assigned: false, signed: false },
}

function backend() {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(owner)),
    http.get('*/api/platform/clinics', () => HttpResponse.json([clinic(1, 'Тест'), clinic(2, 'Улыбка'), clinic(3, 'Жемчуг')])),
    http.get('*/api/platform/applications', () => HttpResponse.json([])),
    http.get('*/api/platform/agreements/statuses', () => HttpResponse.json(statuses)),
    http.get('*/api/platform/pay-requests', () => HttpResponse.json([])),
    http.get('*/api/platform/clinics/:id/plan', () => HttpResponse.json({ billing: { state: 'FREE' }, doctors: 1, payments: [] } satisfies Schemas['ClinicPaymentsPlan'])),
  )
}

test('подписи: статус, каналы админов — только числа, текст ответа «Напомнить», кнопка бота', () => {
  expect(adminsLine({ telegram: 2, phone: 1, push: 1 })).toBe('✈️ Telegram 2 · 📱 по номеру 1 · 🔔 push 1')
  expect(adminsLine({ telegram: 0, phone: 0, push: 0 })).toBe('руководителей нет')
  expect(statusText(statuses['2']).text).toBe('v3 · назначена — не подписан')
  expect(statusText(statuses['3']).text).toBe('не адресован')
  expect(remindedText({ clinics: 2, skipped: 1, telegram: 3, push: 1, bannerOnly: 1 }))
    .toBe('Напомнили клиникам: 2. Руководителям в Telegram — 3, в приложение — 1, только баннер — 1. Уже напоминали за сутки — пропущено: 1.')
  expect(readDeepLink('?screen=agreement')).toEqual({ page: 'settings', tab: 'agreement' })
})

test('список клиник: версия и подпись, «У кого Telegram», фильтр «Не подписали» и «Напомнить всем»', async () => {
  backend()
  let reminded = 0
  server.use(http.post('*/api/platform/agreements/remind', () => {
    reminded++
    return HttpResponse.json({ clinics: 1, skipped: 0, telegram: 2, push: 1, bannerOnly: 0 } satisfies Schemas['AgreementRemindersReminded'])
  }))
  const user = userEvent.setup()
  renderApp()
  const table = await screen.findByRole('table', { name: 'Клиники' })
  const row = (name: string) => within(table).getByRole('button', { name: new RegExp(name) }).closest('tr')!
  expect(await within(row('Улыбка')).findByText('v3 · назначена — не подписан')).toBeInTheDocument()
  expect(within(row('Улыбка')).getByText('✈️ Telegram 2 · 📱 по номеру 1 · 🔔 push 1')).toBeInTheDocument()
  expect(within(row('Жемчуг')).getByText('не адресован')).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: /Не подписали договор: 1/ }))
  expect(within(table).queryByRole('button', { name: /Тест/ })).not.toBeInTheDocument()
  expect(within(table).queryByRole('button', { name: /Жемчуг/ })).not.toBeInTheDocument()
  expect(within(table).getByRole('button', { name: /Улыбка/ })).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Напомнить всем не подписавшим' }))
  await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Напомнить' }))
  expect(await screen.findByText(/Напомнили клиникам: 1\. Руководителям в Telegram — 2, в приложение — 1, только баннер — 0/)).toBeInTheDocument()
  expect(reminded).toBe(1)
})

test('карточка клиники: назначить версию для подписи и напомнить; 409 «уже напоминали» — текстом', async () => {
  backend()
  let assigned: unknown = null
  let remindCalls = 0
  server.use(
    http.get('*/api/platform/clinics/:id/agreement', () => HttpResponse.json({
      current: { id: 13, version: 3, title: 'Договор', acceptances: 0, forAll: true },
      targeting: {
        assignedVersionId: undefined,
        choices: [
          { id: 13, version: 3, title: 'Договор', publishedAt: '2026-11-02T06:00:00Z', forAll: false, signed: false },
          { id: 11, version: 1, title: 'Договор', publishedAt: '2026-10-01T06:00:00Z', forAll: true, signed: true },
        ],
        admins: { telegram: 2, phone: 1, push: 1 },
      },
      scans: [],
    } satisfies Schemas['AgreementsClinicAgreement'])),
    http.put('*/api/platform/clinics/:id/agreement/assignment', async ({ request }) => {
      assigned = await request.json()
      return HttpResponse.json({ scans: [] } satisfies Schemas['AgreementsClinicAgreement'])
    }),
    http.post('*/api/platform/clinics/:id/agreement/remind', () => {
      remindCalls++
      return remindCalls === 1
        ? HttpResponse.json({ clinics: 1, skipped: 0, telegram: 2, push: 1, bannerOnly: 0 } satisfies Schemas['AgreementRemindersReminded'])
        : HttpResponse.json({ status: 409, title: 'Conflict', code: 'too-often', detail: 'Этой клинике уже напоминали за последние сутки — повторить можно завтра' }, { status: 409 })
    }),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('button', { name: /Улыбка/ }))
  const panel = await screen.findByRole('complementary', { name: 'Клиника на платформе' })
  expect(await within(panel).findByText('Версия 3 не подписана')).toBeInTheDocument()
  expect(within(panel).getByText(/Руководители: ✈️ Telegram 2 · 📱 по номеру 1 · 🔔 push 1/)).toBeInTheDocument()

  await choose(within(panel).getByRole('combobox', { name: 'Какую версию подписать' }), 'Версия 1')
  expect(assigned).toEqual({ versionId: 11 })

  await user.click(within(panel).getByRole('button', { name: 'Напомнить подписать' }))
  expect(await within(panel).findByText(/Напомнили клиникам: 1\. Руководителям в Telegram — 2/)).toBeInTheDocument()
  await user.click(within(panel).getByRole('button', { name: 'Напомнить подписать' }))
  expect(await within(panel).findByRole('alert')).toHaveTextContent('уже напоминали за последние сутки')
})

test('версия договора: опубликовать выбранным клиникам — поиск и галочки', async () => {
  backend()
  let published: unknown = 'none'
  server.use(
    http.get('*/api/platform/agreements', () => HttpResponse.json([
      { id: 5, version: 2, title: 'Договор', body: 'Текст', forAll: true, clinicIds: [], acceptances: 0 },
      { id: 4, version: 1, title: 'Договор', body: 'Текст', publishedAt: '2026-10-01T06:00:00Z', acceptances: 1, forAll: false, clinicIds: [1, 2] },
    ] satisfies Schemas['AgreementsVersion'][])),
    http.put('*/api/platform/agreements/:id', () => HttpResponse.json({ id: 5, version: 0, acceptances: 0, forAll: true } satisfies Schemas['AgreementsVersion'])),
    http.post('*/api/platform/agreements/:id/publish', async ({ request }) => {
      published = await request.json()
      return HttpResponse.json({ id: 5, version: 0, acceptances: 0, forAll: true } satisfies Schemas['AgreementsVersion'])
    }),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await findSub('Договор'))
  expect(await screen.findByText(/выбранным клиникам: 2 · подписали: 1/)).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: /Версия 2 · Договор/ }))
  const panel = await screen.findByRole('complementary', { name: 'Версия договора' })
  expect(within(panel).getByRole('button', { name: 'Опубликовать — всем клиникам' })).toBeEnabled()

  await user.click(within(panel).getByRole('button', { name: /Выбранным клиникам/ }))
  expect(within(panel).getByRole('button', { name: 'Опубликовать — клиникам: 0' })).toBeDisabled()
  await user.type(within(panel).getByRole('searchbox', { name: 'Найти клинику' }), 'улыб')
  expect(within(panel).queryByRole('checkbox', { name: 'Тест' })).not.toBeInTheDocument()
  await user.click(within(panel).getByRole('checkbox', { name: 'Улыбка' }))
  await user.click(within(panel).getByRole('button', { name: 'Опубликовать — клиникам: 1' }))
  await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Опубликовать' }))
  await waitForSlow(() => expect(published).toEqual({ all: false, clinicIds: [2] }))
})
