import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { Join } from '../site/Join'
import { me, renderApp, findSub } from '../test/fixtures'
import { server } from '../test/server'
import { caseMissing } from './joinCase'

const filled: Schemas['JoinCaseCase'] = {
  title: 'Пилот в клинике в Бишкеке', text: 'Пациенты записываются в боте, напоминания уходят сами.', clinic: 'Стоматология «Тест»',
  metrics: [{ value: '120', label: 'записей через бота за месяц' }], consent: true, shown: true,
}
const empty: Schemas['JoinCaseCase'] = { metrics: [], consent: false, shown: false }

test('/join: блок кейса есть, только когда сервер отдал опубликованный кейс', async () => {
  server.use(http.get('*/web/tariffs', () => HttpResponse.json({ pilotMonths: 3, tariffs: [] })))
  const first = render(<Join />)
  expect(await screen.findByText(/Попробовать — бесплатно/)).toBeInTheDocument()
  expect(screen.queryByRole('region', { name: 'Как работает в клинике' })).not.toBeInTheDocument()
  first.unmount()

  server.use(http.get('*/web/case', () => HttpResponse.json(filled)))
  render(<Join />)
  const block = await screen.findByRole('region', { name: 'Как работает в клинике' })
  expect(within(block).getByRole('heading', { name: 'Пилот в клинике в Бишкеке' })).toBeInTheDocument()
  expect(within(block).getByText('Стоматология «Тест»')).toBeInTheDocument()
  expect(within(block).getByText('120')).toBeInTheDocument()
  expect(within(block).getByText('записей через бота за месяц')).toBeInTheDocument()
})

test('/join: shown = false (нет согласия или текста) — блока нет', async () => {
  server.use(
    http.get('*/web/tariffs', () => HttpResponse.json({ pilotMonths: 3, tariffs: [] })),
    http.get('*/web/case', () => HttpResponse.json({ ...empty, title: 'Черновик' })),
  )
  render(<Join />)
  expect(await screen.findByText(/Попробовать — бесплатно/)).toBeInTheDocument()
  expect(screen.queryByText('Черновик')).not.toBeInTheDocument()
})

test('чего не хватает для публикации', () => {
  expect(caseMissing({ title: '', text: '', consent: false })).toEqual(['заголовок', 'история', 'отметка «клиника согласна на публикацию»'])
  expect(caseMissing({ title: 'Т', text: 'Т', consent: false })).toEqual(['отметка «клиника согласна на публикацию»'])
  expect(caseMissing({ title: 'Т', text: 'Т', consent: true })).toEqual([])
})

function platform(draft: Schemas['JoinCaseCase'], onSave: (body: Schemas['JoinCaseRequest']) => Schemas['JoinCaseCase']) {
  window.location.hash = '/platform'
  server.use(
    http.get('*/web/config', () => HttpResponse.json({ botUsername: 'tish_test_bot' })),
    http.get('*/api/patient/me', () => HttpResponse.json({ ...me, owner: true, platform: true })),
    http.get('*/api/platform/clinics', () => HttpResponse.json([])),
    http.get('*/api/platform/applications', () => HttpResponse.json([])),
    http.get('*/api/platform/agreements/statuses', () => HttpResponse.json({})),
    http.get('*/api/platform/pay-requests', () => HttpResponse.json([])),
    http.get('*/api/platform-info', () => HttpResponse.json({})),
    http.get('*/web/tariffs', () => HttpResponse.json({ pilotMonths: 3, tariffs: [] })),
    http.get('*/api/platform/case', () => HttpResponse.json(draft)),
    http.put('*/api/platform/case', async ({ request }) => HttpResponse.json(onSave(await request.json() as Schemas['JoinCaseRequest']))),
  )
}

afterEach(() => {
  window.location.hash = ''
})

test('«Платформа → Настройки»: пустой кейс — объяснение, «?» с подробностями и чего не хватает', async () => {
  platform(empty, () => empty)
  const user = userEvent.setup()
  renderApp()
  await user.click(await findSub('Настройки'))
  const box = await screen.findByRole('region', { name: 'Кейс на странице для клиник' })
  expect(within(box).getByText(/История одной клиники с цифрами/)).toBeInTheDocument()
  expect(within(box).queryByRole('note', { name: 'Как работает кейс' })).not.toBeInTheDocument()
  await user.click(within(box).getByRole('button', { name: 'Подробнее про кейс на /join' }))
  const more = within(box).getByRole('note', { name: 'Как работает кейс' })
  expect(more).toHaveTextContent('Tish их сам не считает')
  expect(more).toHaveTextContent('Без отметки кейс остаётся черновиком')
  expect(within(box).getByLabelText('Состояние кейса'))
    .toHaveTextContent('Кейс не показывается на /join, пока нет: заголовок, история, отметка «клиника согласна на публикацию».')
  expect(within(box).getByText(/здесь появится блок/)).toBeInTheDocument()
  expect(within(box).getByRole('link', { name: 'Открыть tish.kg/join ↗' })).toHaveAttribute('href', '/join')
})

test('«Платформа → Настройки»: заполнили без согласия — черновик, предпросмотр как на /join; с согласием — публикуется', async () => {
  const saved: Schemas['JoinCaseRequest'][] = []
  platform(empty, (body) => {
    saved.push(body)
    const shown = Boolean(body.title && body.text && body.consent)
    return { ...filled, consent: Boolean(body.consent), shown }
  })
  const user = userEvent.setup()
  renderApp()
  await user.click(await findSub('Настройки'))
  const form = await screen.findByRole('form', { name: 'Кейс' })
  await user.type(within(form).getByRole('textbox', { name: 'Заголовок блока' }), 'Пилот в клинике в Бишкеке')
  await user.type(within(form).getByRole('textbox', { name: 'История: что было до Tish и что стало' }), 'Пациенты записываются в боте.')
  await user.type(within(form).getByRole('textbox', { name: 'Клиника — как подписать (по желанию)' }), 'Стоматология «Тест»')
  const first = within(form).getByRole('group', { name: 'Цифра 1' })
  await user.type(within(first).getByRole('textbox', { name: 'Цифра 1' }), '120')
  await user.type(within(first).getByRole('textbox', { name: 'Что она значит' }), 'записей через бота за месяц')

  // Предпросмотр — та же разметка, что на /join
  const preview = within(form).getByRole('region', { name: 'Как работает в клинике' })
  expect(within(preview).getByRole('heading', { name: 'Пилот в клинике в Бишкеке' })).toBeInTheDocument()
  expect(within(preview).getByText('120')).toBeInTheDocument()
  expect(within(form).getByLabelText('Состояние кейса')).toHaveTextContent('пока нет: отметка «клиника согласна на публикацию»')

  await user.click(within(form).getByRole('button', { name: 'Сохранить кейс' }))
  expect(await within(form).findByRole('status')).toHaveTextContent('черновик — на /join блока нет')
  expect(saved[0]).toEqual({ title: 'Пилот в клинике в Бишкеке', text: 'Пациенты записываются в боте.', clinic: 'Стоматология «Тест»',
    consent: false, metrics: [{ value: '120', label: 'записей через бота за месяц' }] })

  await user.click(within(form).getByRole('checkbox', { name: /Клиника согласна на публикацию/ }))
  expect(within(form).getByLabelText('Состояние кейса')).toHaveTextContent('После сохранения кейс виден на /join')
  await user.click(within(form).getByRole('button', { name: 'Сохранить кейс' }))
  expect(await within(form).findByText('Сохранено — блок виден на /join')).toBeInTheDocument()
  expect(saved[1]?.consent).toBe(true)
})
