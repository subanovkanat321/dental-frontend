import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { appointment, me } from '../test/fixtures'
import { server } from '../test/server'
import { waitForSlow } from '../test/wait'
import { renderSections } from './noteSections'
import { ProposalReview } from './ProposalReview'
import { reviewOf } from './review'
import { VisitNote } from './VisitNote'

// Вымышленный пациент «Бакыт Тестов»
const visit = appointment(20, 1, '10:00', 'Бакыт Тестов', { status: 'DONE', patient: { id: 7, fullName: 'Бакыт Тестов', phone: '996555000777', telegram: false } })

type Calls = { put: Schemas['ChartControllerNote'][]; queries: string[]; apply: Schemas['VisitDictationApply'][] }

function backend(note: Schemas['ChartControllerNoteView']): Calls {
  const calls: Calls = { put: [], queries: [], apply: [] }
  server.use(
    http.get('*/api/appointments/:id/note', () => HttpResponse.json(note)),
    http.put('*/api/appointments/:id/note', async ({ request }) => {
      const body = await request.json() as Schemas['ChartControllerNote']
      calls.put.push(body)
      return HttpResponse.json({ ...note, note: body.note, sections: body.sections } satisfies Schemas['ChartControllerNoteView'])
    }),
    http.get('*/api/patients/:id/notes', () => HttpResponse.json([] satisfies Schemas['VisitNoteView'][])),
    http.get('*/api/diagnoses/suggest', ({ request }) => {
      const q = new URL(request.url).searchParams.get('q') ?? ''
      calls.queries.push(q)
      const body: Schemas['DiagnosesSuggestions'] = q.startsWith('пульп')
        ? { codes: [{ code: 'K04.0', title: 'Пульпит' }, { code: 'K04.1', title: 'Некроз пульпы' }], own: [{ text: 'Хронический фиброзный пульпит', code: 'K04.0', title: 'Пульпит', uses: 4 }] }
        : { codes: [{ code: 'K02.1', title: 'Кариес дентина' }], own: [{ text: 'Средний кариес', code: 'K02.1', title: 'Кариес дентина', uses: 7 }] }
      return HttpResponse.json(body)
    }),
    http.post('*/api/appointments/:id/dictation/apply', async ({ request }) => {
      const body = await request.json() as Schemas['VisitDictationApply']
      calls.apply.push(body)
      return HttpResponse.json({ teeth: [], plan: [], note: body.note, sections: body.sections } satisfies Schemas['VisitDictationApplied'])
    }),
  )
  return calls
}

function renderWith(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

test('«Диагноз»: поиск МКБ-10 → чип с зубом, своя формулировка → текст; «Сохранить» — коды в разделах', async () => {
  const calls = backend({ editable: true, sectionsOn: true })
  const user = userEvent.setup()
  renderWith(<VisitNote appointment={visit} me={me} />)
  await user.click(await screen.findByRole('button', { name: '＋ Диагноз' }))
  const box = screen.getByRole('combobox', { name: 'Диагноз по МКБ-10' })
  expect(box).toHaveFocus()
  // Пустое поле — частые коды клиники и формулировки
  const list = await screen.findByRole('listbox', { name: 'Подсказки диагноза' })
  expect(list).toHaveTextContent('Частые коды клиники')
  await user.type(box, 'пульп')
  await user.click(await screen.findByRole('option', { name: /K04\.0 Пульпит/ }))
  const chips = screen.getByRole('list', { name: 'Диагнозы МКБ-10' })
  expect(chips).toHaveTextContent('K04.0Пульпит')
  await user.type(within(chips).getByRole('textbox', { name: 'Зуб к диагнозу K04.0' }), '36')
  // Своя формулировка клиники: текст в поле, её код уже стоит — не повторяется
  await user.type(screen.getByRole('combobox', { name: 'Диагноз по МКБ-10' }), 'пульп')
  await user.click(await screen.findByRole('option', { name: /Хронический фиброзный пульпит/ }))
  expect(screen.getByRole('textbox', { name: 'Диагноз своими словами' })).toHaveValue('Хронический фиброзный пульпит')
  expect(within(chips).getAllByRole('listitem')).toHaveLength(2)
  // Код без зуба из формулировки — убрать ✕
  await user.click(within(chips).getByRole('button', { name: 'Убрать диагноз K04.0 Пульпит' }))
  await user.click(screen.getByRole('button', { name: 'Сохранить заметку' }))
  expect(calls.put).toHaveLength(1)
  expect(calls.put[0]!.sections).toEqual({ diagnosis: 'Хронический фиброзный пульпит', diagnosisCodes: [{ code: 'K04.0', title: 'Пульпит', tooth: 36 }] })
  expect(calls.put[0]!.note).toBe('Диагноз: K04.0 Пульпит, зуб 36 — Хронический фиброзный пульпит')
  // В запрос подсказок уходит только то, что ищут, без пациента
  expect(calls.queries).toContain('пульп')
})

test('Esc в подсказках закрывает их, а не карточку; Enter берёт первую подсказку', async () => {
  backend({ editable: true, sectionsOn: true, sections: { diagnosis: 'кариес' }, note: 'Диагноз: кариес' })
  const user = userEvent.setup()
  const onKey = vi.fn()
  window.addEventListener('keydown', onKey)
  renderWith(<VisitNote appointment={visit} me={me} />)
  const box = await screen.findByRole('combobox', { name: 'Диагноз по МКБ-10' })
  await user.click(box)
  await screen.findByRole('listbox')
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  expect(onKey).not.toHaveBeenCalled()
  window.removeEventListener('keydown', onKey)
  await user.type(box, 'кар')
  await screen.findByRole('option', { name: /^K02\.1 Кариес/ })
  await user.keyboard('{Enter}')
  expect(screen.getByRole('list', { name: 'Диагнозы МКБ-10' })).toHaveTextContent('K02.1')
})

test('«Проверьте» диктовки: код МКБ от ИИ — чипом, лишний убирается и не уходит в /dictation/apply', async () => {
  const calls = backend({ editable: true, sectionsOn: true })
  const user = userEvent.setup()
  const review = reviewOf({ teeth: [], plan: [], sections: { diagnosis: 'Кариес дентина 36', diagnosisCodes: [{ code: 'K02.1', title: 'Кариес дентина', tooth: 36 }, { code: 'K04.0', title: 'Пульпит' }] } },
    { note: '', sections: {}, sectionsMode: true }, true)
  renderWith(<ProposalReview appointment={visit} initial={review} onSaved={() => {}} onCancel={() => {}} />)
  const chips = screen.getByRole('list', { name: 'Диагнозы МКБ-10' })
  expect(chips).toHaveTextContent('K02.1 Кариес дентина · 36')
  await user.click(within(chips).getByRole('button', { name: 'Убрать диагноз K04.0 Пульпит' }))
  await user.click(screen.getByRole('button', { name: 'Сохранить' }))
  await waitForSlow(() => expect(calls.apply).toHaveLength(1))
  expect(calls.apply[0]!.sections?.diagnosisCodes).toEqual([{ code: 'K02.1', title: 'Кариес дентина', tooth: 36 }])
})

test('полный текст — как у сервера: коды, затем свой текст', () => {
  expect(renderSections({ complaints: 'Болит', diagnosisCodes: [{ code: 'K02.1', title: 'Кариес дентина', tooth: 36 }, { code: 'K05.1', title: 'Хронический гингивит' }], diagnosis: 'глубокий' }))
    .toBe('Жалобы: Болит\nДиагноз: K02.1 Кариес дентина, зуб 36; K05.1 Хронический гингивит — глубокий')
})
