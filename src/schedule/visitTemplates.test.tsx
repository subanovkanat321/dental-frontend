import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { appointment, me } from '../test/fixtures'
import { server } from '../test/server'
import { VisitNote } from './VisitNote'

// Вымышленный пациент «Бакыт Тестов» и его прошлые визиты
const visit = appointment(20, 1, '10:00', 'Бакыт Тестов', { status: 'DONE', serviceName: 'Лечение кариеса', patient: { id: 7, fullName: 'Бакыт Тестов', phone: '996555000777', telegram: false } })

const template: Schemas['VisitTemplatesView'] = {
  id: 5, title: 'Кариес — пломба', shared: false, editable: true, note: 'Кариес {зуб}', toothState: 'FILLING', plan: ['Контроль {зуб}'],
  serviceTypeId: 3, serviceName: 'Лечение кариеса', usesTeeth: true,
}
const shared: Schemas['VisitTemplatesView'] = {
  id: 6, title: 'Профгигиена', shared: true, editable: false, sections: { treatment: 'Чистка Air Flow', recommendations: 'Не есть 2 часа' }, usesTeeth: false,
}

const past: Schemas['VisitNoteView'][] = [
  { appointmentId: 11, startAt: '2026-10-12T04:00:00Z', editable: true, note: 'Жалобы: Болит при холодном\nДиагноз: Кариес 36',
    sections: { complaints: 'Болит при холодном', diagnosis: 'Кариес 36' }, visitDoctorName: 'Айгерим Садыкова' },
  { appointmentId: 10, startAt: '2026-09-01T04:00:00Z', editable: true, note: 'Аллергия на лидокаин — артикаин' },
]

type Calls = { put: Schemas['ChartControllerNote'][]; apply: Schemas['VisitDictationApply'][]; proposal: unknown[]; created: Schemas['VisitTemplatesFields'][] }

function backend(note: Schemas['ChartControllerNoteView'], opts: { parse?: Schemas['VisitDictationProposal'] } = {}): Calls {
  const calls: Calls = { put: [], apply: [], proposal: [], created: [] }
  server.use(
    http.get('*/api/appointments/:id/note', () => HttpResponse.json(note)),
    http.put('*/api/appointments/:id/note', async ({ request }) => {
      const body = await request.json() as Schemas['ChartControllerNote']
      calls.put.push(body)
      return HttpResponse.json({ ...note, note: body.note, sections: body.sections } satisfies Schemas['ChartControllerNoteView'])
    }),
    http.get('*/api/patients/:id/notes', () => HttpResponse.json([
      { appointmentId: visit.id, startAt: visit.startAt, editable: true, note: note.note }, ...past,
    ] satisfies Schemas['VisitNoteView'][])),
    http.get('*/api/visit-templates', () => HttpResponse.json([template, shared])),
    http.post('*/api/appointments/:id/visit-templates/:tid/proposal', async ({ request, params }) => {
      calls.proposal.push(await request.json())
      return HttpResponse.json((Number(params.tid) === 5
        ? { teeth: [{ tooth: 36, state: 'FILLING', surfaces: [], was: 'CARIES' }], plan: [{ tooth: 36, title: 'Контроль 36' }], note: 'Кариес 36', service: { id: 3, name: 'Лечение кариеса' } }
        : { teeth: [], plan: [], sections: shared.sections }) satisfies Schemas['VisitDictationProposal'])
    }),
    http.post('*/api/appointments/:id/dictation/apply', async ({ request }) => {
      const body = await request.json() as Schemas['VisitDictationApply']
      calls.apply.push(body)
      return HttpResponse.json({ teeth: [], plan: [], note: body.note, sections: body.sections } satisfies Schemas['VisitDictationApplied'])
    }),
    http.post('*/api/appointments/:id/dictation/parse', () => HttpResponse.json(opts.parse ?? { teeth: [], plan: [] })),
    http.get('*/api/service-types', () => HttpResponse.json([{ id: 3, name: 'Лечение кариеса', durationMinutes: 60, active: true, priceSom: 2500 }] satisfies Schemas['ServiceTypeView'][])),
    http.post('*/api/visit-templates', async ({ request }) => {
      const body = await request.json() as Schemas['VisitTemplatesFields']
      calls.created.push(body)
      return HttpResponse.json({ ...template, id: 9, title: body.title ?? '' } satisfies Schemas['VisitTemplatesView'], { status: 201 })
    }),
  )
  return calls
}

function renderNote(who: Schemas['BookingViewsMe'] = me) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><VisitNote appointment={visit} me={who} /></QueryClientProvider>)
}

test('«📄 Шаблон»: зубы → тот же экран «Проверьте», «Сохранить» — /dictation/apply с зубами, планом, заметкой и услугой', async () => {
  const calls = backend({ note: 'Анестезия без реакции', editable: true, sectionsOn: false })
  renderNote()
  await userEvent.click(await screen.findByRole('button', { name: '📄 Шаблон' }))
  const sheet = await screen.findByRole('dialog', { name: 'Шаблоны приёма' })
  expect(within(sheet).getByRole('group', { name: 'Общие клиники' })).toHaveTextContent('Профгигиена')
  await userEvent.click(within(sheet).getByRole('button', { name: /Кариес — пломба/ }))
  await userEvent.type(within(sheet).getByRole('textbox', { name: 'Номера зубов' }), '36')
  await userEvent.click(within(sheet).getByRole('button', { name: 'Применить' }))
  const review = await screen.findByRole('region', { name: 'Проверьте шаблон' })
  expect(calls.proposal).toEqual([{ teeth: [36] }])
  expect(review).toHaveTextContent('Шаблон «Кариес — пломба»')
  expect(within(review).getByRole('textbox', { name: 'Заметка из шаблона' })).toHaveValue('Анестезия без реакции\nКариес 36')
  expect(within(review).getByText(/Услуга приёма/)).toHaveTextContent('Лечение кариеса')
  await userEvent.click(within(review).getByRole('button', { name: 'Сохранить' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Сохранено в медкарту · зубов: 1 · шагов плана: 1')
  expect(calls.apply[0]).toMatchObject({
    teeth: [{ tooth: 36, state: 'FILLING' }], plan: [{ tooth: 36, title: 'Контроль 36' }], note: 'Анестезия без реакции\nКариес 36', serviceTypeId: 3,
  })
  expect(calls.apply[0]!.sections).toBeUndefined()
})

test('разделы включены: пустые — чипами «＋ Жалобы», старая заметка — в «Заметке», сохранение — разделами', async () => {
  const calls = backend({ note: 'Старая заметка', editable: true, sectionsOn: true })
  renderNote()
  const form = await screen.findByRole('form', { name: 'Заметка о приёме' })
  expect(within(form).getByRole('textbox', { name: 'Заметка' })).toHaveValue('Старая заметка')
  expect(within(form).queryByRole('textbox', { name: 'Жалобы' })).not.toBeInTheDocument()
  await userEvent.click(within(form).getByRole('button', { name: '＋ Жалобы' }))
  await userEvent.type(within(form).getByRole('textbox', { name: 'Жалобы' }), 'Болит при холодном')
  await userEvent.click(within(form).getByRole('button', { name: '＋ Рекомендации' }))
  await userEvent.type(within(form).getByRole('textbox', { name: 'Рекомендации' }), 'Не есть 2 часа')
  await userEvent.click(within(form).getByRole('button', { name: 'Сохранить заметку' }))
  await screen.findByText('Сохранено')
  expect(calls.put[0]).toEqual({
    note: 'Жалобы: Болит при холодном\nРекомендации: Не есть 2 часа\nСтарая заметка',
    sections: { complaints: 'Болит при холодном', recommendations: 'Не есть 2 часа', other: 'Старая заметка' },
  })
})

test('шаблон с разделами — к своим разделам; диктовка с разделами — тоже', async () => {
  const calls = backend({ note: 'Жалобы: Болит', sections: { complaints: 'Болит' }, editable: true, sectionsOn: true }, {
    parse: { teeth: [], plan: [], note: '', sections: { treatment: 'Пломба 36', recommendations: 'Не есть 2 часа' } },
  })
  renderNote()
  await userEvent.click(await screen.findByRole('button', { name: '📄 Шаблон' }))
  await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Профгигиена/ }))
  let review = await screen.findByRole('region', { name: 'Проверьте шаблон' })
  expect(within(review).getByRole('textbox', { name: 'Жалобы — из шаблона' })).toHaveValue('Болит')
  expect(within(review).getByRole('textbox', { name: 'Лечение — из шаблона' })).toHaveValue('Чистка Air Flow')
  await userEvent.click(within(review).getByRole('button', { name: 'Отмена' }))

  // Диктовка: без распознавания речи — поле текста, «Разобрать» → разделы от ИИ
  await userEvent.click(await screen.findByRole('button', { name: '🎤 Надиктовать приём' }))
  await userEvent.type(screen.getByRole('textbox', { name: 'Текст диктовки' }), 'на 36 пломба не есть два часа')
  await userEvent.click(screen.getByRole('button', { name: 'Разобрать' }))
  review = await screen.findByRole('region', { name: 'Проверьте диктовку' })
  expect(within(review).getByRole('textbox', { name: 'Лечение — из диктовки' })).toHaveValue('Пломба 36')
  await userEvent.click(within(review).getByRole('button', { name: 'Сохранить' }))
  await screen.findByText(/Сохранено в медкарту/)
  expect(calls.apply[0]!.sections).toEqual({ complaints: 'Болит', treatment: 'Пломба 36', recommendations: 'Не есть 2 часа' })
  expect(calls.apply[0]!.note).toBe('Жалобы: Болит\nЛечение: Пломба 36\nРекомендации: Не есть 2 часа')
})

test('«Из прошлого визита»: галочки по разделам, «Отметить все / Сбросить», «Вставить» — выбранное в заметку', async () => {
  backend({ editable: true, sectionsOn: true })
  renderNote()
  await userEvent.click(await screen.findByRole('button', { name: '↩ Из прошлого визита' }))
  const sheet = await screen.findByRole('dialog', { name: 'Из прошлого визита' })
  expect(within(sheet).getAllByRole('checkbox')).toHaveLength(3)
  await userEvent.click(within(sheet).getByRole('button', { name: 'Отметить все' }))
  expect(within(sheet).getByRole('button', { name: 'Вставить (3)' })).toBeEnabled()
  await userEvent.click(within(sheet).getByRole('button', { name: 'Сбросить' }))
  await userEvent.click(within(sheet).getByRole('checkbox', { name: /^Жалобы от/ }))
  await userEvent.click(within(sheet).getByRole('checkbox', { name: /^Заметка от/ }))
  await userEvent.click(within(sheet).getByRole('button', { name: 'Вставить (2)' }))
  const form = screen.getByRole('form', { name: 'Заметка о приёме' })
  expect(within(form).getByRole('textbox', { name: 'Жалобы' })).toHaveValue('Болит при холодном')
  expect(within(form).getByRole('textbox', { name: 'Заметка' })).toHaveValue('Аллергия на лидокаин — артикаин')
  expect(within(form).queryByRole('textbox', { name: 'Диагноз' })).not.toBeInTheDocument()
  expect(within(form).getByRole('button', { name: 'Сохранить заметку' })).toBeInTheDocument()
})

test('«Прошлые визиты» под заметкой: свёрнуты, дата — заметка того визита только для чтения', async () => {
  backend({ note: 'Сегодня', editable: true, sectionsOn: false })
  renderNote()
  const fold = await screen.findByRole('region', { name: 'Прошлые визиты' })
  expect(fold).toHaveTextContent('2')
  await userEvent.click(within(fold).getByRole('button', { name: /Прошлые визиты/ }))
  const dates = within(fold).getAllByRole('button', { expanded: false })
  expect(dates).toHaveLength(2)
  await userEvent.click(dates[1]!)
  expect(within(fold).getByText('Аллергия на лидокаин — артикаин')).toBeInTheDocument()
  expect(within(fold).queryByRole('textbox')).not.toBeInTheDocument()
})

test('«Сохранить как шаблон»: название, услуга приёма по галочке, «общий» — у руководителя', async () => {
  const calls = backend({ note: 'Жалобы: Болит', sections: { complaints: 'Болит' }, editable: true, sectionsOn: true })
  renderNote()
  await userEvent.click(await screen.findByRole('button', { name: 'Сохранить как шаблон' }))
  const sheet = await screen.findByRole('dialog', { name: 'Сохранить как шаблон' })
  const title = within(sheet).getByRole('textbox', { name: 'Название' })
  await userEvent.clear(title)
  await userEvent.type(title, 'Осмотр')
  await within(sheet).findByText(/С услугой приёма: Лечение кариеса/)
  await userEvent.click(within(sheet).getByRole('checkbox', { name: /Общий для клиники/ }))
  await userEvent.click(within(sheet).getByRole('button', { name: 'Сохранить шаблон' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Шаблон «Осмотр» сохранён')
  expect(calls.created[0]).toEqual({ title: 'Осмотр', sections: { complaints: 'Болит' }, serviceTypeId: 3, shared: true })
})
