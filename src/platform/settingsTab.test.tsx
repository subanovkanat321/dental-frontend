import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp, findSub, querySub } from '../test/fixtures'
import { server } from '../test/server'
import { waitForSlow } from '../test/wait'

// «Платформа → Настройки» (2026-11-14): тарифы и договор с клиниками — разделами внутри, карточки по темам;
// старые вкладки «Тарифы» и «Договор» ведут сюда, к своему разделу.

const tariffs: Schemas['Tariffs'] = {
  pilotMonths: 3,
  tariffs: [
    { code: 'SOLO', name: 'Кабинет', who: '1 врач', maxDoctors: 1, monthSom: 990, yearSom: 9900 },
    { code: 'LARGE', name: 'Клиника', who: 'Все остальные', monthSom: 2490, yearSom: 24900 },
  ],
}
const version = { id: 7, version: 2, title: 'Договор оферты', body: '# Договор', publishedAt: '2026-11-01T06:00:00Z', forAll: true, clinicIds: [], acceptances: 3, sha256: 'abc' } as Schemas['AgreementsVersion']

beforeEach(() => {
  window.location.hash = '/platform'
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json({ ...me, owner: true, platform: true } satisfies Schemas['BookingViewsMe'])),
    http.get('*/api/platform/clinics', () => HttpResponse.json([])),
    http.get('*/api/platform/applications', () => HttpResponse.json([])),
    http.get('*/api/platform/agreements/statuses', () => HttpResponse.json({})),
    http.get('*/api/platform/pay-requests', () => HttpResponse.json([])),
    http.get('*/web/tariffs', () => HttpResponse.json(tariffs)),
    http.get('*/api/platform/agreements', () => HttpResponse.json([version])),
  )
})
afterEach(() => {
  window.location.hash = ''
})

test('«Настройки»: тарифы и договор с клиниками — разделами; карточки по темам; вкладок «Тарифы» и «Договор» нет', async () => {
  const user = userEvent.setup()
  renderApp()
  await user.click(await findSub('Настройки'))
  const tariffsForm = await screen.findByRole('form', { name: 'Тарифы' })
  expect(within(tariffsForm).getByRole('heading', { name: /Тарифы/ })).toBeInTheDocument()
  expect(within(tariffsForm).getByLabelText('В месяц: Кабинет')).toHaveValue(990)
  const contract = screen.getByRole('region', { name: 'Договор с клиниками' })
  expect(await within(contract).findByRole('button', { name: 'Версия 2 · Договор оферты' })).toBeInTheDocument()
  for (const name of ['Оплата для клиник', 'Менеджеры платформы', 'Поддержка и сведения о платформе', 'Кейс на /join', 'Группа врачей и бот', 'Ваши входы в клиники']) {
    expect(screen.getByRole('heading', { name: new RegExp(name.replace('/', '\\/')) })).toBeInTheDocument()
  }
  expect(screen.queryByRole('link', { name: /во вкладке «Тарифы»/ })).not.toBeInTheDocument()
  expect(querySub('Тарифы')).not.toBeInTheDocument()
  expect(querySub('Договор')).not.toBeInTheDocument()

  // Версия договора — карточкой справа, как была во вкладке
  await user.click(within(contract).getByRole('button', { name: 'Версия 2 · Договор оферты' }))
  const panel = await screen.findByRole('complementary', { name: 'Версия договора' })
  expect(within(panel).getByText(/подписали: 3/)).toBeInTheDocument()
  await user.click(within(panel).getByRole('button', { name: 'Закрыть' }))
  expect(screen.queryByRole('complementary', { name: 'Версия договора' })).not.toBeInTheDocument()
})

test.each([
  ['/platform/tariffs', '#/platform/settings/tariffs', 'platform-settings-tariffs'],
  ['/platform/agreements', '#/platform/settings/contract', 'platform-settings-contract'],
  ['/platform/contract', '#/platform/settings/contract', 'platform-settings-contract'],
])('старый адрес %s — «Настройки» и прокрутка к разделу', async (old, now, id) => {
  const scrolled: string[] = []
  // jsdom не умеет прокручивать — подставим свою, запоминающую, к чему прокрутили
  const before = Element.prototype.scrollIntoView
  Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this.id) }
  window.location.hash = old
  renderApp()
  const tabs = await screen.findByRole('navigation', { name: 'Подразделы: Платформа' })
  expect(await within(tabs).findByRole('link', { name: 'Настройки' })).toHaveAttribute('aria-current', 'page')
  expect(window.location.hash).toBe(now)
  await screen.findByRole('region', { name: 'Договор с клиниками' })
  await waitForSlow(() => expect(scrolled).toContain(id))
  Element.prototype.scrollIntoView = before
})
