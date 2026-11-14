import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { linkHash, readDeepLink } from '../lib/deepLink'
import { me, renderApp, findSub, openPlatform } from '../test/fixtures'
import { server } from '../test/server'
import { waitForSlow } from '../test/wait'

// «Платформа» (2026-11-14): 14 вкладок объединены в 9 — режимы внутри вкладок, старые адреса ведут в нужный режим.

const owner = { ...me, owner: true, platform: true } satisfies Schemas['BookingViewsMe']
const clinic = (id: number, name: string) => ({
  id, name, code: `c${id}`, doctors: 1, staff: 1, patients: 3, appointments: 4, done30: 4, noShow30: 0, health: 'OK', billing: { state: 'FREE' }, bookedWeek: 0, selfBooked30: 0, unmarked: 0, hidden: false, listed: true, settingUp: false,
}) satisfies Schemas['PlatformServiceClinicRow']

function backend(who: Schemas['BookingViewsMe'] = owner) {
  // Всё прочее «Платформы» — пусто: здесь важны вкладки и режимы, а не содержимое (свои ответы ниже — важнее: позже добавлены)
  server.use(http.get('*/api/platform/*', () => HttpResponse.json([])))
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(who)),
    http.get('*/web/config', () => HttpResponse.json({ botUsername: 'tish_test_bot' })),
    http.get('*/api/platform/clinics', () => HttpResponse.json([clinic(1, 'Улыбка'), clinic(2, 'Жемчуг')])),
    http.get('*/api/platform/agreements/statuses', () => HttpResponse.json({})),
    http.get('*/api/platform/content/instagram', () => HttpResponse.json({ enabled: false })),
    http.get('*/api/platform/broadcasts', () => HttpResponse.json([
      { id: 1, text: 'В субботу плановые работы', sentAt: '2026-11-10T06:00:00Z', clinics: 12, recipients: 11, delivered: 8 },
    ])),
  )
}

const modes = () => within(document.querySelector<HTMLElement>('.platform-modes')!)
const pressed = () => modes().getAllByRole('button').find((b) => b.getAttribute('aria-pressed') === 'true')?.textContent

afterEach(() => {
  window.location.hash = ''
})

test.each([
  ['/platform/outreach', 'Рассылка клиникам', 'По одной (WhatsApp)', '#/platform/mailing/one'],
  ['/platform/broadcast', 'Рассылка клиникам', 'Всем сразу (руководителям)', '#/platform/mailing/all'],
  ['/platform/tickets', 'Обратная связь', 'Обращения', '#/platform/feedback/tickets'],
  ['/platform/support', 'Обратная связь', 'Обращения', '#/platform/feedback/tickets'],
  ['/platform/surveys', 'Обратная связь', 'Опросы', '#/platform/feedback/surveys'],
  ['/platform/content', 'Маркетинг', 'Контент-план', '#/platform/marketing/content'],
  ['/platform/materials', 'Маркетинг', 'Материалы', '#/platform/marketing/materials'],
])('старый адрес %s — вкладка «%s», режим «%s»', async (old, tab, mode, now) => {
  backend()
  window.location.hash = old
  renderApp()
  expect(await findSub(tab)).toHaveAttribute('aria-current', 'page')
  await waitForSlow(() => expect(pressed()).toBe(mode))
  expect(window.location.hash).toBe(now)
})

test('режим — в адресе: переключили — адрес и экран сменились; вернулись во вкладку — тот же режим', async () => {
  backend()
  window.location.hash = '/platform'
  const user = userEvent.setup()
  renderApp()
  await openPlatform('Рассылка клиникам', undefined, user)
  expect(pressed()).toBe('По одной (WhatsApp)')
  expect(await screen.findByRole('region', { name: 'Написать клиникам' })).toBeInTheDocument()
  await user.click(modes().getByRole('button', { name: 'Всем сразу (руководителям)' }))
  expect(window.location.hash).toBe('#/platform/mailing/all')
  expect(await screen.findByRole('form', { name: 'Сообщение клиникам' })).toBeInTheDocument()
  expect(screen.queryByRole('region', { name: 'Написать клиникам' })).not.toBeInTheDocument()

  await user.click(await findSub('Клиники'))
  await user.click(await findSub('Рассылка клиникам'))
  expect(pressed()).toBe('Всем сразу (руководителям)')
})

test('«Рассылка → Всем сразу»: предпросмотр как у руководителя и история «дошло руководителям: N из M»', async () => {
  backend()
  window.location.hash = '/platform'
  const user = userEvent.setup()
  renderApp()
  await openPlatform('Рассылка клиникам', 'Всем сразу (руководителям)', user)
  const preview = await screen.findByRole('region', { name: 'Как увидит руководитель' })
  const bubble = within(preview).getByLabelText('Предпросмотр сообщения')
  expect(bubble).toHaveTextContent('📣 Сообщение от команды Tish')
  expect(bubble).toHaveTextContent('Здесь появится ваш текст')
  await user.type(within(screen.getByRole('form', { name: 'Сообщение клиникам' })).getByRole('textbox'), 'Новое в приложении')
  expect(bubble).toHaveTextContent(/📣 Сообщение от команды Tish\s*Новое в приложении/)
  expect(await within(preview).findByText(/руководителям всех клиник \(2\)/)).toBeInTheDocument()

  const history = screen.getByRole('list', { name: 'Отправленные сообщения' })
  expect(await within(history).findByText('В субботу плановые работы')).toBeInTheDocument()
  expect(within(history).getByText(/дошло руководителям: 8 из 11/)).toBeInTheDocument()
})

test('«Обратная связь»: обращения и опросы — режимами; менеджеру — только «Опросы», без переключателя', async () => {
  backend()
  window.location.hash = '/platform'
  const user = userEvent.setup()
  const first = renderApp()
  await openPlatform('Обратная связь', 'Опросы', user)
  expect(window.location.hash).toBe('#/platform/feedback/surveys')
  await user.click(modes().getByRole('button', { name: 'Обращения' }))
  expect(await screen.findByText('Обращений пока нет')).toBeInTheDocument()
  first.unmount()

  backend({ ...me, doctor: false, admin: false, platform: true, owner: false })
  window.location.hash = '/platform/surveys'
  renderApp()
  expect(await findSub('Опросы')).toHaveAttribute('aria-current', 'page')
  expect(document.querySelector('.platform-modes')).toBeNull()
})

test('кнопка бота «Обращения клиник» (?screen=support-tickets) — «Обратная связь → Обращения»', () => {
  expect(linkHash(readDeepLink('?screen=support-tickets')!)).toBe('platform/feedback/tickets')
})
