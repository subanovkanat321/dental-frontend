import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp, medTab, openMedicalTab } from '../test/fixtures'
import { server } from '../test/server'

beforeEach(() => {
  window.location.hash = '/patients'
})
afterEach(() => {
  window.location.hash = ''
})

type Step = Schemas['TreatmentStepView']

/** Вымышленный пациент; медкарта меняется, как на сервере. */
function backend(options: { forbidden?: boolean } = {}) {
  let teeth: Schemas['ToothView'][] = [{ number: 16, state: 'CARIES', note: 'глубокий', doctorName: 'Айгерим Садыкова', updatedAt: '2026-10-20T05:00:00Z' }]
  let plan: Step[] = [{ id: 1, tooth: 16, title: 'Пломба', priceSom: 3000 }]
  const sent: unknown[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', () => HttpResponse.json([])),
    http.get('*/api/patients/recent', () => HttpResponse.json([{ id: 2, fullName: 'Айгуль Т.', phone: '996700333444' }])),
    http.get('*/api/appointments/by-patient/2', () => HttpResponse.json({
      patient: { id: 2, fullName: 'Айгуль Т.', phone: '996700333444' }, done: 1, noShow: 0, cancelled: 0, upcoming: [], past: [],
    })),
    http.get('*/api/appointments/debts', () => HttpResponse.json([])),
    http.get('*/api/patients/2/teeth', () => options.forbidden
      ? HttpResponse.json({ status: 403, detail: 'Медкарту видят врач пациента и руководитель' }, { status: 403 })
      : HttpResponse.json(teeth)),
    http.put('*/api/patients/2/teeth/:n', async ({ request, params }) => {
      const body = (await request.json()) as Schemas['ChartControllerUpdate']
      sent.push({ tooth: Number(params.n), ...body })
      teeth = [...teeth.filter((t) => t.number !== Number(params.n)), { number: Number(params.n), state: body.state, note: body.note }]
      return HttpResponse.json(teeth)
    }),
    http.get('*/api/patients/2/plan', () => HttpResponse.json(plan)),
    http.post('*/api/patients/2/plan', async ({ request }) => {
      const body = (await request.json()) as Step
      sent.push({ plan: body })
      plan = [...plan, { ...body, id: 2 }]
      return HttpResponse.json(plan)
    }),
    http.put('*/api/patients/2/plan/:id', async ({ request, params }) => {
      const body = (await request.json()) as { done: boolean; title?: string; tooth?: number; priceSom?: number }
      sent.push({ step: Number(params.id), ...body })
      plan = plan.map((s) => (s.id === Number(params.id)
        ? { ...s, title: body.title ?? s.title, tooth: body.tooth, priceSom: body.priceSom, doneAt: body.done ? '2026-10-31T05:00:00Z' : undefined }
        : s))
      return HttpResponse.json(plan)
    }),
    http.get('*/api/patients/2/notes', () => HttpResponse.json([
      { appointmentId: 5, startAt: '2026-10-20T05:00:00Z', note: 'Жалобы на холодное', doctorName: 'Айгерим Садыкова', visitDoctorName: 'Айгерим Садыкова', editable: true },
      // Заметка другого врача пациента — только для чтения, подписана «Врач: …»
      { appointmentId: 4, startAt: '2026-09-01T05:00:00Z', note: 'Удаление 38 без осложнений', doctorName: 'Бекболот Асанов', visitDoctorName: 'Бекболот Асанов', editable: false },
    ] satisfies Schemas['VisitNoteView'][])),
    http.get('*/api/patients/2/files', () => HttpResponse.json([{ id: 7, kind: 'XRAY', caption: 'Прицельный 16', takenOn: '2026-10-20', canDelete: true }])),
    http.get('*/api/patients/2/files/7', () => new HttpResponse(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/jpeg' } })),
  )
  return sent
}

async function openMedical() {
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Айгуль Т.' }))
  await openMedicalTab()
  expect(await screen.findByRole('heading', { name: 'Медкарта · Айгуль Т.' })).toBeInTheDocument()
}

test('медкарта: зуб 16 — кариес с заметкой; отметить 26 «Пломба»; план — сумма, отметить сделанным, добавить этап', async () => {
  const sent = backend()
  await openMedical()
  expect(await screen.findByRole('button', { name: 'Зуб 16: Кариес, есть заметка' })).toBeInTheDocument()

  await userEvent.click(screen.getByRole('button', { name: 'Зуб 26: Здоров' }))
  const editor = screen.getByRole('form', { name: 'Зуб 26' })
  await userEvent.click(within(editor).getByRole('button', { name: /Пломба/ }))
  await userEvent.type(within(editor).getByLabelText('Заметка'), 'композит')
  await userEvent.click(within(editor).getByRole('button', { name: 'Сохранить' }))
  expect(await screen.findByRole('button', { name: 'Зуб 26: Пломба, есть заметка' })).toBeInTheDocument()
  expect(sent).toContainEqual({ tooth: 26, state: 'FILLING', surfaces: [], note: 'композит' })

  // Зубы и план — разные вкладки медкарты
  await medTab('План лечения')
  const plan = await screen.findByRole('list', { name: 'Этапы лечения' })
  expect(await screen.findByRole('heading', { name: /План лечения/ })).toHaveTextContent(/3\s000 сом/)
  await userEvent.click(within(plan).getByLabelText('Сделано: Пломба'))
  expect(await within(plan).findByLabelText('Сделано: Пломба')).toBeChecked()

  const add = screen.getByRole('form', { name: 'Новый этап' })
  // Не вписали «Что сделать» — кнопка не молчит, а подсказывает
  await userEvent.click(within(add).getByRole('button', { name: '＋ Добавить в план' }))
  expect(within(add).getByRole('alert')).toHaveTextContent('Впишите, что сделать')
  expect(within(add).getByLabelText('Что сделать')).toHaveFocus()
  await userEvent.type(within(add).getByLabelText('Зуб'), '26')
  await userEvent.type(within(add).getByLabelText('Что сделать'), 'Коронка')
  await userEvent.type(within(add).getByLabelText('Цена, сом'), '12000')
  await userEvent.click(within(add).getByRole('button', { name: '＋ Добавить в план' }))
  expect(await within(plan).findByText('Коронка')).toBeInTheDocument()
  expect(within(add).getByRole('status')).toHaveTextContent('Добавлено в план — сохранено')
  expect(sent).toContainEqual({ plan: { title: 'Коронка', tooth: 26, priceSom: 12000, stage: 1 } })

  await medTab('Снимки')
  expect(await screen.findByText('Прицельный 16')).toBeInTheDocument()
  await medTab('Заметки')
  expect(await screen.findByText('Жалобы на холодное')).toBeInTheDocument()
  // Чужая заметка — с именем врача приёма; своя — без «Врач:»
  const other = screen.getByText('Удаление 38 без осложнений').closest('li')!
  expect(other).toHaveTextContent('Врач: Бекболот Асанов')
  expect(screen.getByText('Жалобы на холодное').closest('li')).not.toHaveTextContent('Врач:')

  await userEvent.click(screen.getByRole('button', { name: '← К списку' }))
  expect(await screen.findByRole('complementary', { name: 'Карточка пациента' })).toBeInTheDocument()
})

test('не свой пациент — 403: замок с текстом сервера, а не ошибка всей CRM', async () => {
  backend({ forbidden: true })
  await openMedical()
  expect(await screen.findByText(/Медкарту видят врач пациента и руководитель/)).toBeInTheDocument()
  expect(screen.queryByRole('group', { name: 'Верхняя челюсть' })).not.toBeInTheDocument()
})

test('отмеченные зубы списком; зуб → «В план лечения» подставляет номер; этап можно изменить', async () => {
  const sent = backend()
  await openMedical()
  const marked = await screen.findByRole('list', { name: 'Отмеченные зубы' })
  expect(marked).toHaveTextContent(/16.*Кариес.*глубокий/)

  await userEvent.click(screen.getByRole('button', { name: 'Зуб 16: Кариес, есть заметка' }))
  await userEvent.click(within(screen.getByRole('form', { name: 'Зуб 16' })).getByRole('button', { name: 'В план лечения' }))
  const add = screen.getByRole('form', { name: 'Новый этап' })
  expect(within(add).getByLabelText('Зуб')).toHaveValue('16')
  expect(within(add).getByLabelText('Что сделать')).toHaveFocus()

  const plan = screen.getByRole('list', { name: 'Этапы лечения' })
  await userEvent.click(within(plan).getByRole('button', { name: 'Изменить этап: Пломба' }))
  const edit = within(plan).getByRole('form', { name: 'Этап: Пломба' })
  await userEvent.clear(within(edit).getByLabelText('Что сделать на этапе'))
  await userEvent.type(within(edit).getByLabelText('Что сделать на этапе'), 'Пломба композит')
  await userEvent.clear(within(edit).getByLabelText('Цена этапа, сом'))
  await userEvent.type(within(edit).getByLabelText('Цена этапа, сом'), '3500')
  await userEvent.click(within(edit).getByRole('button', { name: 'Сохранить' }))
  expect(await within(plan).findByText('Пломба композит')).toBeInTheDocument()
  expect(sent).toContainEqual({ step: 1, tooth: 16, title: 'Пломба композит', priceSom: 3500, stage: 1, done: false })
})
