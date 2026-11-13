import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { counted } from './workbook'

type Report = Schemas['WorkbookImportReport']

/** Что насчитал сервер по вымышленному шаблону: по листам, ошибки строк (без имён и номеров). */
const PREVIEW: Report = {
  sheets: [
    { kind: 'PATIENTS', title: 'Пациенты', rows: 250, added: 246, updated: 1, unchanged: 1, errorCount: 2 },
    { kind: 'SERVICES', title: 'Услуги и цены', rows: 35, added: 35, updated: 0, unchanged: 0, errorCount: 0 },
    { kind: 'STAFF', title: 'Врачи и сотрудники', rows: 2, added: 2, updated: 0, unchanged: 0, errorCount: 0 },
    { kind: 'APPOINTMENTS', title: 'Будущие записи', rows: 13, added: 12, updated: 0, unchanged: 0, errorCount: 1 },
    { kind: 'DEBTS', title: 'Долги', rows: 5, added: 5, updated: 0, unchanged: 0, errorCount: 0 },
  ],
  skipped: ['Заметки'],
  extraPatients: 2,
  errorCount: 3,
  errors: [
    { sheet: 'Пациенты', row: 7, column: 'Телефон', message: 'Номер в формате 0555 123 456 или с кодом страны: +7 701 123 45 67' },
    { sheet: 'Пациенты', row: 9, column: 'ФИО', message: 'Нет имени' },
    { sheet: 'Будущие записи', row: 4, column: 'Время', message: 'Кресло занято: «Кресло 1» в это время у врача Осмонов Бакыт' },
  ],
  applied: false,
  summary: 'пациентов +248, услуг +35, сотрудников +2, записей +12, долгов +5, строк с ошибками 3',
}

function backend() {
  const previews: FormData[] = []
  const applied: FormData[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/clinic/audit', () => HttpResponse.json({ items: [], total: 0 } satisfies Schemas['AuditLogPage'])),
    http.post('*/api/clinic/import/workbook/preview', async ({ request }) => {
      previews.push(await request.formData())
      return HttpResponse.json(PREVIEW)
    }),
    http.post('*/api/clinic/import/workbook', async ({ request }) => {
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

async function openWorkbook() {
  const user = userEvent.setup()
  renderApp()
  const box = await screen.findByRole('region', { name: 'Загрузить из Excel' })
  await user.click(within(box).getByRole('button', { name: 'Шаблон Tish (всё)' }))
  return { user, box }
}

test('шаблон Tish: ссылка на пустой шаблон, предпросмотр по листам и ошибки строк, одна кнопка «Загрузить»', async () => {
  const { previews, applied } = backend()
  const { user, box } = await openWorkbook()
  expect(within(box).getByRole('link', { name: 'пример шаблона Tish.xlsx' })).toHaveAttribute('href', '/web/import/tish-perenos.xlsx')

  const file = new File(['xlsx'], 'перенос.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  await user.upload(within(box).getByLabelText('Заполненный шаблон'), file)

  const summary = await within(box).findByLabelText('Предпросмотр')
  expect(summary).toHaveTextContent('Добавим 248 пациентов, 35 услуг, 2 сотрудника, 12 записей, 5 долгов')
  expect(summary).toHaveTextContent('строк с ошибкой: 3 — их не загрузим')
  const sheets = within(summary).getByRole('table', { name: 'По листам' })
  const patients = within(sheets).getByRole('row', { name: /Пациенты/ })
  expect(patients).toHaveTextContent('дополним пустые поля: 1')
  expect(within(patients).getAllByRole('cell').map((c) => c.textContent)).toEqual([expect.stringContaining('Пациенты'), '250', '248', '1', '2'])
  expect(summary).toHaveTextContent('Из них 2 пациента — из записей и долгов')
  expect(summary).toHaveTextContent('Пропустим незнакомые листы: «Заметки»')
  const errors = within(summary).getByRole('table', { name: 'Ошибки в строках' })
  expect(within(errors).getAllByRole('row')).toHaveLength(4)
  expect(errors).toHaveTextContent('Будущие записи')
  expect(errors).toHaveTextContent('Кресло занято')
  expect(previews).toHaveLength(1)
  expect(previews[0]!.get('file')).toBeTruthy()
  expect(applied).toHaveLength(0)

  await user.click(within(box).getByRole('button', { name: 'Загрузить' }))
  const done = await within(box).findByRole('status')
  expect(done).toHaveTextContent('Загружено: 248 пациентов, 35 услуг, 2 сотрудника, 12 записей, 5 долгов. Строк с ошибками не загрузили: 3')
  expect(applied).toHaveLength(1)
})

test('шаблон Tish: не тот файл — ошибка сервера под полем; пустые листы — «заполните шаблон», загружать нечего', async () => {
  backend()
  let empty = false
  server.use(http.post('*/api/clinic/import/workbook/preview', () => empty
    ? HttpResponse.json({ sheets: [], skipped: [], extraPatients: 0, errorCount: 0, errors: [], applied: false, summary: 'ничего нового' } satisfies Report)
    : HttpResponse.json({ status: 422, title: 'Unprocessable Entity', detail: 'Проверьте поля',
      errors: [{ field: 'file', message: 'Нужен файл .xlsx — шаблон Tish с листами' }] }, { status: 422 })))
  const { user, box } = await openWorkbook()
  await user.upload(within(box).getByLabelText('Заполненный шаблон'), new File(['a;b'], 'база.xlsx'))
  expect(await within(box).findByRole('alert')).toHaveTextContent('Нужен файл .xlsx — шаблон Tish с листами')

  empty = true
  await user.upload(within(box).getByLabelText('Заполненный шаблон'), new File(['x'], 'пустой.xlsx'))
  expect(await within(box).findByRole('note')).toHaveTextContent('Листы пустые')
  expect(within(box).getByRole('button', { name: 'Загрузить' })).toBeDisabled()
})

test('числа со словами: 1 пациента, 2 сотрудника, 5 долгов, 11 услуг, 21 запись', () => {
  expect(counted(1, 'PATIENTS')).toBe('1 пациента')
  expect(counted(2, 'STAFF')).toBe('2 сотрудника')
  expect(counted(5, 'DEBTS')).toBe('5 долгов')
  expect(counted(11, 'SERVICES')).toBe('11 услуг')
  expect(counted(21, 'APPOINTMENTS')).toBe('21 запись')
})

test('выбор файла — своя кнопка «📎 Выбрать файл (.xlsx)» и имя файла рядом, файл уходит на предпросмотр', async () => {
  const { previews } = backend()
  const { user, box } = await openWorkbook()
  expect(within(box).getByRole('button', { name: '📎 Выбрать заполненный шаблон' })).toBeInTheDocument()
  expect(within(box).getByText('файл не выбран')).toBeInTheDocument()

  await user.upload(within(box).getByLabelText('Заполненный шаблон'), new File(['xlsx'], 'клиника-перенос.xlsx'))
  expect(within(box).getByText('клиника-перенос.xlsx')).toBeInTheDocument()
  await within(box).findByLabelText('Предпросмотр')
  expect(previews).toHaveLength(1)
  expect((previews[0]!.get('file') as File).size).toBe(4)

  await user.click(within(box).getByRole('button', { name: 'Отмена' }))
  expect(within(box).getByText('файл не выбран')).toBeInTheDocument()
  expect(within(box).getByLabelText<HTMLInputElement>('Заполненный шаблон').value).toBe('')
})
