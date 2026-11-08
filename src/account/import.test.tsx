import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { DataTab } from './DataTab'

type Report = Schemas['DataImportReport']

/** Вымышленная таблица пациентов: заголовки, первые строки и что насчитал сервер. */
const HEADERS = ['№', 'Пациент', 'Тел.', 'Д.р.']
const PREVIEW: Report = {
  kind: 'PATIENTS', headers: HEADERS, rows: 4,
  sample: [['1', 'Пример Айгерим', '0555 000 101', '14.03.1990'], ['2', 'Пример Нурай', '0555 000 101', '']],
  columns: { fullName: 1, phone: 2, birthDate: 3 },
  added: 2, updated: 1, unchanged: 0, sharedPhone: 1, errorCount: 1,
  errors: [{ row: 5, column: 'Тел.', message: 'Номер в формате 0555 123 456 или с кодом страны: +7 701 123 45 67' }],
  applied: false, summary: 'пациентов: добавлено 2',
}

function backend() {
  const previews: FormData[] = []
  const applied: FormData[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/clinic/audit', () => HttpResponse.json({ items: [], total: 0 } satisfies Schemas['AuditLogPage'])),
    http.post('*/api/clinic/import/preview', async ({ request }) => {
      const form = await request.formData()
      previews.push(form)
      // Колонку телефона сняли — сервер считать нечего
      return HttpResponse.json({ ...PREVIEW, columns: form.has('fullName') ? { fullName: Number(form.get('fullName')), phone: form.has('phone') ? 2 : undefined } : PREVIEW.columns } satisfies Report)
    }),
    http.post('*/api/clinic/import', async ({ request }) => {
      applied.push(await request.formData())
      return HttpResponse.json({ ...PREVIEW, applied: true } satisfies Report)
    }),
  )
  return { previews, applied }
}

beforeEach(() => {
  window.location.hash = '/settings/data'
})
afterEach(() => {
  window.location.hash = ''
})

test('загрузка пациентов из Excel: колонки угаданы, предпросмотр с дублями и ошибками, «Загрузить»', async () => {
  const { previews, applied } = backend()
  const user = userEvent.setup()
  renderApp()
  const box = await screen.findByRole('region', { name: 'Загрузить из Excel' })
  const file = new File(['ФИО;Телефон\nПример;0555000101\n'], 'база.csv', { type: 'text/csv' })
  await user.upload(within(box).getByLabelText('Файл таблицы'), file)

  // Колонки — угаданные сервером; первые строки — таблицей
  expect(await within(box).findByRole('heading', { name: 'Колонки' })).toBeInTheDocument()
  expect(previews[0]!.get('kind')).toBe('PATIENTS')
  expect((previews[0]!.get('file') as Blob).size).toBeGreaterThan(0)
  expect(previews[0]!.has('fullName')).toBe(false)
  expect(within(within(box).getByRole('table', { name: 'Первые строки файла' })).getAllByRole('row')).toHaveLength(3)

  const summary = within(box).getByLabelText('Предпросмотр')
  expect(summary).toHaveTextContent(/Будет добавлено: 2/)
  expect(summary).toHaveTextContent(/дополним пустую дату рождения или место работы: 1/)
  expect(summary).toHaveTextContent(/С ошибками — не загрузим: 1/)
  expect(summary).toHaveTextContent('семья на одном номере')
  const errors = within(summary).getByRole('table', { name: 'Ошибки в строках' })
  expect(within(errors).getAllByRole('row')[1]).toHaveTextContent(/5Тел\.Номер в формате/)

  await user.click(within(box).getByRole('button', { name: 'Загрузить' }))
  expect(await within(box).findByRole('status')).toHaveTextContent('Загружено: добавлено 2, дополнено 1, пропущено 1 (с ошибками 1)')
  expect(applied[0]!.get('fullName')).toBe('1')
  expect(applied[0]!.get('phone')).toBe('2')
  expect(applied[0]!.get('birthDate')).toBe('3')
  // Файл с пациентами не остаётся в браузере
  expect(JSON.stringify(localStorage)).not.toContain('Пример')
})

test('без колонки телефона «Загрузить» выключена; поправленные колонки уходят на сервер', async () => {
  const { previews } = backend()
  const user = userEvent.setup()
  renderApp()
  const box = await screen.findByRole('region', { name: 'Загрузить из Excel' })
  await user.upload(within(box).getByLabelText('Файл таблицы'), new File(['x'], 'база.xlsx'))
  await within(box).findByRole('heading', { name: 'Колонки' })
  await user.click(within(box).getByRole('combobox', { name: 'Телефон *' }))
  await user.click(await screen.findByRole('option', { name: '— нет —' }))
  expect(await within(box).findByText('Выберите колонки с ФИО и телефоном')).toBeInTheDocument()
  expect(within(box).getByRole('button', { name: 'Загрузить' })).toBeDisabled()
  expect(previews.at(-1)!.get('fullName')).toBe('1')
  expect(previews.at(-1)!.has('phone')).toBe(false)
})

test('ошибка файла — текст сервера; прайс — свои поля', async () => {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/clinic/audit', () => HttpResponse.json({ items: [], total: 0 } satisfies Schemas['AuditLogPage'])),
    http.post('*/api/clinic/import/preview', () => HttpResponse.json(
      { detail: 'Проверьте поля', errors: [{ field: 'file', message: 'Больше 10000 строк — разделите файл на части' }] }, { status: 422 })),
  )
  const user = userEvent.setup()
  renderApp()
  const box = await screen.findByRole('region', { name: 'Загрузить из Excel' })
  await user.click(within(box).getByRole('button', { name: 'Прайс услуг' }))
  await user.upload(within(box).getByLabelText('Файл таблицы'), new File(['x'], 'прайс.csv'))
  expect(await within(box).findByRole('alert')).toHaveTextContent('Больше 10000 строк')
})

test('не админ (видит всех врачей) — выгрузка есть, «Загрузить из Excel» нет', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><DataTab me={{ ...me, admin: false }} seesAll /></QueryClientProvider>)
  expect(await screen.findByRole('button', { name: 'Прислать архив в бот' })).toBeInTheDocument()
  expect(screen.queryByRole('region', { name: 'Загрузить из Excel' })).not.toBeInTheDocument()
})
