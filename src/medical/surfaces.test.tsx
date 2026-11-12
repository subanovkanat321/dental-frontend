import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { createQueryClient } from '../api/queryClient'
import { MedicalRecord } from './MedicalRecord'
import { stateText, surfacesText, visitToothText } from './toothStates'
import { medTab } from '../test/fixtures'
import { server } from '../test/server'

// Поверхности зуба (V161), «Несколько» и «На весь экран» в медкарте. Пациент вымышленный
type Tooth = Schemas['ToothView']
type Step = Schemas['TreatmentStepView']

function backend(initial: Tooth[] = []) {
  let teeth = [...initial]
  let plan: Step[] = []
  const calls: { put: unknown[]; batch: unknown[]; plan: unknown[] } = { put: [], batch: [], plan: [] }
  server.use(
    http.get('*/api/patients/2/teeth', () => HttpResponse.json(teeth)),
    http.put('*/api/patients/2/teeth/:n', async ({ request, params }) => {
      const body = (await request.json()) as Schemas['ChartControllerUpdate']
      calls.put.push({ number: Number(params.n), ...body })
      teeth = [...teeth.filter((t) => t.number !== Number(params.n)),
        { number: Number(params.n), state: body.state, surfaces: body.surfaces as Tooth['surfaces'], note: body.note }]
      return HttpResponse.json(teeth)
    }),
    http.post('*/api/patients/2/teeth/batch', async ({ request }) => {
      const body = (await request.json()) as Schemas['ChartControllerMany']
      calls.batch.push(body)
      const numbers = body.numbers ?? []
      teeth = [...teeth.filter((t) => !numbers.includes(t.number)),
        ...numbers.map((n) => ({ number: n, state: body.state, surfaces: body.surfaces as Tooth['surfaces'] }))]
      return HttpResponse.json(teeth)
    }),
    http.get('*/api/patients/2/plan', () => HttpResponse.json(plan)),
    http.post('*/api/patients/2/plan/batch', async ({ request }) => {
      const body = (await request.json()) as Schemas['ChartControllerSteps']
      calls.plan.push(body)
      plan = (body.teeth ?? []).map((tooth, i) => ({ id: i + 1, tooth, title: body.title, priceSom: body.priceSom, stage: body.stage ?? 1 }))
      return HttpResponse.json(plan)
    }),
    http.get('*/api/patients/2/teeth/history', () => HttpResponse.json([])),
    http.get('*/api/patients/2/notes', () => HttpResponse.json([])),
    http.get('*/api/patients/2/files', () => HttpResponse.json([])),
    http.get('*/api/patients/2/anamnesis', () => HttpResponse.json({})),
    http.get('*/api/anamnesis/questions', () => HttpResponse.json([])),
    http.get('*/api/service-types', () => HttpResponse.json([])),
    http.get('*/api/patients/2/plan/message', () => HttpResponse.json({ text: '' })),
    http.get('*/api/patients/2/plan/offers', () => HttpResponse.json([])),
  )
  return calls
}

function open(readOnly = false) {
  const client = createQueryClient({ queries: { retry: false } })
  render(<QueryClientProvider client={client}>
    <MedicalRecord patient={{ id: 2, fullName: 'Вымышленная Пациентка', telegram: false }} onBack={() => {}} readOnly={readOnly} />
  </QueryClientProvider>)
}

test('запись поверхностей: МО, у резцов — режущий край, у верхних — нёбная', () => {
  expect(surfacesText(36, ['O', 'M'])).toBe('МО')
  expect(surfacesText(11, ['O', 'L'])).toBe('РН')
  expect(surfacesText(46, ['D', 'L', 'B'])).toBe('ДВЯ')
  expect(stateText(36, 'CARIES', ['M', 'O'])).toBe('Кариес (МО)')
  // У коронки поверхностей не бывает — и не пишем
  expect(stateText(36, 'CROWN', ['O'])).toBe('Коронка')
  expect(visitToothText({ number: 36, state: 'FILLING', surfaces: ['O', 'D'], note: 'композит' })).toBe('36 · Пломба (ОД) · композит')
})

test('поверхности: выбрать в кружке → «МО» в тексте и на рисунке, в запросе — коды латиницей', async () => {
  const calls = backend([{ number: 16, state: 'FILLING', surfaces: ['O', 'D'] }])
  open()
  // Отмеченные поверхности — в подписи зуба и в списке
  expect(await screen.findByRole('button', { name: 'Зуб 16: Пломба (ОД)' })).toBeInTheDocument()
  expect(screen.getByRole('list', { name: 'Отмеченные зубы' })).toHaveTextContent('16 🔵 Пломба (ОД)')

  await userEvent.click(screen.getByRole('button', { name: 'Зуб 36: Здоров' }))
  const editor = screen.getByRole('form', { name: 'Зуб 36' })
  // У здорового зуба кружка нет — поверхности только у кариеса, лечения и пломбы
  expect(within(editor).queryByRole('group', { name: 'Поверхности зуба 36' })).not.toBeInTheDocument()
  await userEvent.click(within(editor).getByRole('button', { name: /Кариес/ }))
  const ring = within(editor).getByRole('group', { name: 'Поверхности зуба 36' })
  await userEvent.click(within(ring).getByRole('button', { name: 'окклюзионная (О)' }))
  // С клавиатуры: фокус на часть кружка и пробел
  within(ring).getByRole('button', { name: 'мезиальная (М)' }).focus()
  await userEvent.keyboard(' ')
  expect(within(ring).getByRole('button', { name: 'мезиальная (М)' })).toHaveAttribute('aria-pressed', 'true')
  expect(within(editor).getByText('МО')).toBeInTheDocument()
  await userEvent.click(within(editor).getByRole('button', { name: 'Сохранить' }))

  expect(await screen.findByRole('button', { name: 'Зуб 36: Кариес (МО)' })).toBeInTheDocument()
  expect(calls.put).toEqual([{ number: 36, state: 'CARIES', surfaces: ['M', 'O'] }])
  // На рисунке зуба закрашены те же поверхности
  const glyph = screen.getByRole('button', { name: 'Зуб 36: Кариес (МО)' }).querySelector('.tooth-glyph [data-part=surfaces]')!
  expect([...glyph.querySelectorAll('[data-surface]')].map((x) => x.getAttribute('data-surface'))).toEqual(['O', 'M'])

  // Поменяли на коронку — поверхности не отправляем
  await userEvent.click(screen.getByRole('button', { name: 'Зуб 36: Кариес (МО)' }))
  const again = screen.getByRole('form', { name: 'Зуб 36' })
  await userEvent.click(within(again).getByRole('button', { name: /Коронка/ }))
  await userEvent.click(within(again).getByRole('button', { name: 'Сохранить' }))
  await waitFor(() => expect(calls.put).toHaveLength(2))
  expect(calls.put[1]).toEqual({ number: 36, state: 'CROWN', surfaces: [] })
})

test('«Несколько»: отметить зубы галочками → одно состояние всем и «В план лечения» одним запросом', async () => {
  const calls = backend()
  open()
  await userEvent.click(await screen.findByRole('button', { name: /Несколько/ }))
  expect(screen.getByRole('button', { name: /Несколько/ })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('status')).toHaveTextContent('Нажмите зубы')
  for (const n of [26, 16, 36]) await userEvent.click(screen.getByRole('button', { name: `Зуб ${n}: Здоров` }))
  // Нажатие не открывает редактор одного зуба — только галочка
  expect(screen.queryByRole('form', { name: 'Зуб 36' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Зуб 16: Здоров' })).toHaveAttribute('aria-pressed', 'true')
  const panel = screen.getByRole('region', { name: 'Действия с выбранными зубами' })
  expect(panel).toHaveTextContent('Выбрано зубов: 3 · 16, 26, 36')

  // «В план лечения» — этап каждому выбранному
  await userEvent.click(within(panel).getByRole('button', { name: 'В план лечения' }))
  const form = within(panel).getByRole('form', { name: 'В план лечения выбранным зубам' })
  await userEvent.type(within(form).getByLabelText('Что сделать каждому зубу'), 'Пломба')
  await userEvent.type(within(form).getByLabelText('Цена за зуб, сом'), '2500')
  await userEvent.click(within(form).getByRole('button', { name: 'Добавить 3 в план' }))
  await waitFor(() => expect(calls.plan).toEqual([{ teeth: [16, 26, 36], title: 'Пломба', priceSom: 2500, stage: 1 }]))
  await medTab('План лечения')
  expect(await screen.findByRole('list', { name: 'Этапы лечения' })).toHaveTextContent('16 · Пломба')
  await medTab('Зубы')
  // Вернулись на «Зубы» — режим «Несколько» включаем заново
  await userEvent.click(await screen.findByRole('button', { name: /Несколько/ }))

  // Снова выбрать и поставить «Кариес» с поверхностью О всем
  for (const n of [16, 26]) await userEvent.click(screen.getByRole('button', { name: `Зуб ${n}: Здоров` }))
  const again = screen.getByRole('region', { name: 'Действия с выбранными зубами' })
  await userEvent.click(within(again).getByRole('button', { name: /Кариес/ }))
  await userEvent.click(within(within(again).getByRole('group', { name: 'Поверхности выбранных зубов' }))
    .getByRole('button', { name: 'окклюзионная (режущий край) (О)' }))
  await userEvent.click(within(again).getByRole('button', { name: 'Поставить всем: кариес' }))
  await waitFor(() => expect(calls.batch).toEqual([{ numbers: [16, 26], state: 'CARIES', surfaces: ['O'] }]))
  expect(await screen.findByRole('button', { name: 'Зуб 26: Кариес (О)' })).toBeInTheDocument()
  // После действия режим выключается
  expect(screen.getByRole('button', { name: /Несколько/ })).toHaveAttribute('aria-pressed', 'false')
})

test('«Снять выбор» и ассистент: без «Несколько», но «На весь экран» есть', async () => {
  backend([{ number: 16, state: 'CARIES', surfaces: ['O'] }])
  open(true)
  expect(await screen.findByRole('button', { name: 'Зуб 16: Кариес (О)' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Несколько/ })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '⛶ На весь экран' })).toBeEnabled()
})

test('«На весь экран»: крупная карта без имени и заметок, нажать зуб — подпись; закрыть Esc и ✕', async () => {
  backend([{ number: 16, state: 'CARIES', surfaces: ['M', 'O'], note: 'рабочая заметка' }])
  open()
  const button = await screen.findByRole('button', { name: '⛶ На весь экран' })
  await waitFor(() => expect(button).toBeEnabled())
  await userEvent.click(button)
  const full = screen.getByRole('dialog', { name: 'Карта зубов на весь экран' })
  expect(within(full).getAllByRole('button', { name: /^Зуб \d\d/ })).toHaveLength(32)
  // Имени пациента и заметки врача нет — экран видят другие; имя — только если включить
  expect(full).not.toHaveTextContent('Вымышленная Пациентка')
  expect(full).not.toHaveTextContent('рабочая заметка')
  expect(within(full).getByRole('button', { name: 'Закрыть «На весь экран»' })).toHaveFocus()
  await userEvent.click(within(full).getByRole('button', { name: 'Зуб 16 — кариес (МО)' }))
  expect(within(full).getByText('Зуб 16 — кариес (МО)', { selector: '.fs-caption' })).toBeInTheDocument()
  await userEvent.click(within(full).getByRole('checkbox', { name: 'Имя пациента' }))
  expect(full).toHaveTextContent('Вымышленная Пациентка')

  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('dialog', { name: 'Карта зубов на весь экран' })).not.toBeInTheDocument()
  // Медкарта под слоем осталась
  expect(screen.getByRole('heading', { name: 'Медкарта · Вымышленная Пациентка' })).toBeInTheDocument()

  await userEvent.click(screen.getByRole('button', { name: '⛶ На весь экран' }))
  await userEvent.click(screen.getByRole('button', { name: 'Закрыть «На весь экран»' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
