import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { TemplateSheet } from '../schedule/VisitNoteSheets'
import { appointment, me } from '../test/fixtures'
import { server } from '../test/server'
import { VisitTemplatesPage } from './VisitTemplatesPage'

/**
 * Готовые шаблоны приёма (V251): «＋ Добавить готовые» внизу «Настройки → Шаблоны и заметка» и в пустом листе «📄 Шаблон»
 * карточки приёма — один запрос, готовые ставит и подбирает услуги сервер. Пациент вымышленный.
 */
const caries: Schemas['VisitTemplatesView'] = {
  id: 5, title: 'Кариес — пломба', shared: true, editable: true, usesTeeth: true, toothState: 'FILLING', plan: [],
  sections: { complaints: 'Кратковременная боль в зубе {зуб} от сладкого', diagnosisCodes: [{ code: 'K02.1', title: 'Кариес дентина' }] },
  serviceTypeId: 3, serviceName: 'Лечение кариеса', serviceTypeIds: [3], serviceNames: ['Лечение кариеса'],
}
const hygiene: Schemas['VisitTemplatesView'] = {
  id: 6, title: 'Профгигиена', shared: true, editable: true, usesTeeth: false, plan: [],
  sections: { treatment: 'Ультразвук, Air Flow, полировка', recommendations: 'Профгигиена — раз в 6 месяцев' },
}

function backend(start: Schemas['VisitTemplatesView'][]) {
  const sent = { defaults: 0 }
  let list = start
  server.use(
    http.get('*/api/visit-templates', () => HttpResponse.json(list)),
    http.post('*/api/visit-templates/defaults', () => {
      sent.defaults++
      list = [caries, hygiene]
      return HttpResponse.json(list)
    }),
    http.get('*/api/clinic/note-sections', () => HttpResponse.json({ on: true } satisfies Schemas['ChartControllerSectionsSetting'])),
  )
  return sent
}

function wrap(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

test('настройки: «＋ Добавить готовые» внизу списка возвращает удалённые, ваши не трогает', async () => {
  const sent = backend([caries])
  wrap(<VisitTemplatesPage me={me} onBack={() => {}} />)
  const group = await screen.findByRole('group', { name: 'Общие клиники' })
  expect(group).toHaveTextContent('Кратковременная боль в зубе {зуб} от сладкого')
  expect(screen.getByText(/Удалили готовый шаблон — его можно вернуть/)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: /＋ Добавить готовые/ }))
  expect(await screen.findByRole('status')).toHaveTextContent('Добавлено готовых: 1')
  expect(within(group).getByText('Профгигиена')).toBeInTheDocument()
  expect(sent.defaults).toBe(1)
})

test('лист «📄 Шаблон» без шаблонов: «＋ Добавить готовые» — и сразу можно выбрать', async () => {
  const sent = backend([])
  const visit = appointment(20, 1, '10:00', 'Асан Вымышленный', { status: 'DONE' })
  wrap(<TemplateSheet appointment={visit} onProposal={() => {}} onClose={() => {}} />)
  const sheet = await screen.findByRole('dialog', { name: 'Шаблоны приёма' })
  expect(await within(sheet).findByText(/Шаблонов пока нет. Добавьте готовые/)).toBeInTheDocument()
  await userEvent.click(within(sheet).getByRole('button', { name: /＋ Добавить готовые/ }))
  expect(await within(sheet).findByRole('button', { name: /Кариес — пломба/ })).toHaveTextContent('зубы: пломба')
  expect(within(sheet).getByRole('button', { name: /Профгигиена/ })).toBeInTheDocument()
  expect(sent.defaults).toBe(1)
})
