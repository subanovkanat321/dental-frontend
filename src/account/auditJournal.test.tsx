import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { waitForSlow } from '../test/wait'

type Entry = Schemas['AuditLogEntry']

/** Вымышленные сотрудники и записи — без пациентов: в журнале их имён нет. */
const entry = (id: number, who: string, text: string, at: string, category: Entry['category'] = 'APPOINTMENTS'): Entry =>
  ({ id, who, telegramId: who === 'Жылдыз' ? 22 : 11, text, at, category, action: 'appointment.cancel' })

const settings: Schemas['AuditControllerSettings'] = {
  actions: [
    { code: 'appointment.create', category: 'APPOINTMENTS', title: 'Новая запись (сотрудником)', mandatory: false, enabled: true },
    { code: 'appointment.no-show', category: 'APPOINTMENTS', title: '«Не пришёл»', mandatory: false, enabled: true },
    { code: 'appointment.cancel', category: 'APPOINTMENTS', title: 'Отмена записи', mandatory: true, enabled: true },
    { code: 'money.payment', category: 'MONEY', title: 'Отметка оплаты приёма', mandatory: true, enabled: true },
  ],
}

let requests: URLSearchParams[] = []

beforeEach(() => {
  requests = []
  window.location.hash = '/settings/data'
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/clinic/audit/people', () => HttpResponse.json([
      { telegramId: 11, name: 'Айгерим Садыкова' }, { telegramId: 22, name: 'Жылдыз' },
    ] satisfies Schemas['AuditLogPerson'][])),
    http.get('*/api/clinic/audit/settings', () => HttpResponse.json(settings)),
    http.get('*/api/clinic/audit', ({ request }) => {
      const q = new URL(request.url).searchParams
      requests.push(q)
      if (q.get('category') === 'MONEY') return HttpResponse.json({ items: [], total: 0 } satisfies Schemas['AuditLogPage'])
      if (q.get('cursor') === 'c1') {
        return HttpResponse.json({ items: [entry(3, 'Жылдыз', 'отменил(а) запись на 01.11.2026 10:00, врач Айгерим Садыкова', '2026-11-01T04:00:00Z')],
          total: 3 } satisfies Schemas['AuditLogPage'])
      }
      return HttpResponse.json({
        items: [
          entry(1, 'Айгерим Садыкова', 'отметил(а) «Не пришёл»: запись на 04.11.2026 09:00, врач Айгерим Садыкова', '2026-11-04T03:30:00Z'),
          entry(2, 'Жылдыз', 'отметил(а) оплату 1 500 сом приёма на 03.11.2026 11:00, врач Дастан Т.', '2026-11-03T05:10:00Z', 'MONEY'),
        ],
        next: 'c1', total: 3,
      } satisfies Schemas['AuditLogPage'])
    }),
  )
})
afterEach(() => {
  window.location.hash = ''
})

test('журнал: фильтры уходят на сервер, «Показать ещё» — по курсору, пусто по фильтру', async () => {
  const user = userEvent.setup()
  renderApp()
  expect(await screen.findByText(/отметил\(а\) «Не пришёл»/)).toBeInTheDocument()
  expect(screen.getByText('Всего: 3, показано 2')).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Показать ещё (осталось 1)' }))
  expect(await screen.findByText(/отменил\(а\) запись на 01\.11\.2026/)).toBeInTheDocument()
  expect(requests.at(-1)!.get('cursor')).toBe('c1')
  expect(screen.queryByRole('button', { name: /Показать ещё/ })).not.toBeInTheDocument()

  const filters = screen.getByRole('group', { name: 'Фильтры журнала' })
  await user.click(within(filters).getByRole('combobox', { name: 'Сотрудник' }))
  await user.click(await screen.findByRole('option', { name: 'Жылдыз' }))
  await waitForSlow(() => expect(requests.at(-1)!.get('who')).toBe('22'))
  expect(requests.at(-1)!.get('cursor')).toBeNull()

  await user.click(within(filters).getByRole('button', { name: 'Сегодня' }))
  await waitForSlow(() => expect(requests.at(-1)!.get('from')).toMatch(/^\d{4}-\d{2}-\d{2}$/))
  expect(requests.at(-1)!.get('from')).toBe(requests.at(-1)!.get('to'))
  expect(requests.at(-1)!.get('who')).toBe('22')

  await user.click(within(filters).getByRole('combobox', { name: 'Тип' }))
  await user.click(await screen.findByRole('option', { name: 'Деньги' }))
  expect(await screen.findByText(/По фильтру ничего/)).toBeInTheDocument()
  expect(requests.at(-1)!.get('category')).toBe('MONEY')

  await user.click(screen.getByRole('button', { name: 'Сбросить фильтры' }))
  await waitForSlow(() => expect(requests.at(-1)!.get('category')).toBeNull())
  expect(requests.at(-1)!.get('who')).toBeNull()
  expect(requests.at(-1)!.get('from')).toBeNull()
})

test('«Настроить журнал»: обязательные — с замком и без галочки, выключенное уходит на сервер', async () => {
  let saved: unknown = null
  server.use(http.put('*/api/clinic/audit/settings', async ({ request }) => {
    saved = await request.json()
    return HttpResponse.json({ actions: settings.actions!.map((a) => a.code === 'appointment.no-show' ? { ...a, enabled: false } : a) })
  }))
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('button', { name: 'Настроить журнал' }))
  const region = await screen.findByRole('region', { name: 'Что записывать' })
  const locked = await within(region).findByRole('checkbox', { name: /Отмена записи/ })
  expect(locked).toBeChecked()
  expect(locked).toBeDisabled()
  expect(within(region).getAllByText('записывается всегда')).toHaveLength(2)
  expect(within(region).getByRole('button', { name: 'Сохранить' })).toBeDisabled()

  await user.click(within(region).getByRole('checkbox', { name: '«Не пришёл»' }))
  await user.click(within(region).getByRole('button', { name: 'Сохранить' }))
  // Своё окно подтверждения: что перестанет записываться
  const dialog = await screen.findByRole('alertdialog')
  expect(dialog).toHaveTextContent('Выключить запись: «Не пришёл»?')
  await user.click(within(dialog).getByRole('button', { name: 'Выключить' }))
  await waitForSlow(() => expect(saved).toEqual({ disabled: ['appointment.no-show'] }))
})

test('сервер отклонил настройку — текст ошибки под галочками', async () => {
  server.use(http.put('*/api/clinic/audit/settings', () => HttpResponse.json({
    status: 422, detail: 'Проверьте поля', errors: [{ field: 'disabled', message: 'Отмена записи записывается всегда — выключить нельзя' }],
  }, { status: 422 })))
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('button', { name: 'Настроить журнал' }))
  const region = await screen.findByRole('region', { name: 'Что записывать' })
  await user.click(await within(region).findByRole('checkbox', { name: 'Новая запись (сотрудником)' }))
  await user.click(within(region).getByRole('button', { name: 'Сохранить' }))
  await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Выключить' }))
  expect(await within(region).findByRole('alert')).toHaveTextContent('записывается всегда — выключить нельзя')
})
