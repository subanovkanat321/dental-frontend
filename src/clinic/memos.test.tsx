import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { choose } from '../test/select'

type Memo = Schemas['CareMemosCareMemoView']

function backend(who: Schemas['BookingViewsMe'] = me) {
  let memos: Memo[] = [
    { id: 1, title: 'После удаления зуба', body: '• Держите тампон.\n\nЗвоните в клинику: {телефон}.', active: true, standard: true, serviceIds: [5] },
    { id: 2, title: 'После отбеливания', body: '• Белая диета 48 часов.', active: true, standard: true, serviceIds: [] },
  ]
  let links: Schemas['CareMemosLink'][] = [{ serviceTypeId: 5, memoId: 1 }]
  const sent: unknown[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(who)),
    http.get('*/api/service-types', () => HttpResponse.json([
      { id: 5, name: 'Удаление зуба', durationMinutes: 30, active: true, category: 'Хирургия' },
    ] satisfies Schemas['ServiceTypeView'][])),
    http.get('*/api/care-memos', () => HttpResponse.json(memos)),
    http.get('*/api/care-memos/links', () => HttpResponse.json(links)),
    http.put('*/api/care-memos/:id', async ({ request, params }) => {
      const body = (await request.json()) as Schemas['CareMemoControllerMemo']
      sent.push({ id: Number(params.id), ...body })
      memos = memos.map((m) => (m.id === Number(params.id) ? { ...m, ...body } : m))
      return HttpResponse.json(memos.find((m) => m.id === Number(params.id)))
    }),
    http.post('*/api/care-memos', async ({ request }) => {
      const body = (await request.json()) as Schemas['CareMemoControllerMemo']
      sent.push({ created: body })
      const memo = { id: 3, title: body.title, body: body.body, active: true, standard: false, serviceIds: [] }
      memos = [...memos, memo]
      return HttpResponse.json(memo)
    }),
    http.put('*/api/care-memos/links/:serviceTypeId', async ({ request, params }) => {
      const body = (await request.json()) as Schemas['CareMemoControllerLinkRequest']
      sent.push({ link: Number(params.serviceTypeId), memoId: body.memoId ?? null })
      links = [{ serviceTypeId: Number(params.serviceTypeId), memoId: body.memoId }]
      return HttpResponse.json(links[0])
    }),
  )
  return sent
}

afterEach(() => {
  window.location.hash = ''
})

test('«Памятки после процедур»: у какой услуги, правка текста, своя памятка', async () => {
  const sent = backend()
  window.location.hash = '/settings/memos'
  renderApp()
  const list = await screen.findByRole('list', { name: 'Памятки' })
  expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('После удаления зубаУдаление зуба')
  expect(within(list).getAllByRole('listitem')[1]).toHaveTextContent('ни у одной услуги')

  await userEvent.click(within(list).getByRole('button', { name: '📋 После отбеливания' }))
  const panel = screen.getByRole('complementary', { name: 'Памятка' })
  const text = within(panel).getByLabelText('Текст для пациента')
  await userEvent.clear(text)
  await userEvent.type(text, 'Без кофе 2 дня.')
  await userEvent.click(within(panel).getByRole('button', { name: 'Сохранить' }))
  expect(await within(panel).findByText('Памятка сохранена')).toBeInTheDocument()
  expect(sent).toContainEqual({ id: 2, title: 'После отбеливания', body: 'Без кофе 2 дня.', active: true })
  await userEvent.click(within(panel).getByRole('button', { name: 'Закрыть' }))

  await userEvent.click(screen.getByRole('button', { name: '＋ Своя памятка' }))
  const fresh = screen.getByRole('complementary', { name: 'Новая памятка' })
  expect((within(fresh).getByLabelText('Текст для пациента') as HTMLTextAreaElement).value).toContain('Телефон клиники: {телефон}')
  await userEvent.type(within(fresh).getByLabelText('Название'), 'После брекетов')
  await userEvent.click(within(fresh).getByRole('button', { name: 'Добавить' }))
  expect(await within(list).findByText('📋 После брекетов')).toBeInTheDocument()
})

test('регистратура памятки только читает', async () => {
  backend({ ...me, admin: false, doctorId: undefined, reception: true })
  window.location.hash = '/settings/memos'
  renderApp()
  const list = await screen.findByRole('list', { name: 'Памятки' })
  expect(screen.queryByRole('button', { name: '＋ Своя памятка' })).not.toBeInTheDocument()
  await userEvent.click(within(list).getByRole('button', { name: '📋 После удаления зуба' }))
  const panel = screen.getByRole('complementary', { name: 'Памятка' })
  expect(panel).toHaveTextContent('Памятки меняют администратор и врачи.')
  expect(within(panel).queryByRole('textbox')).not.toBeInTheDocument()
})

test('карточка услуги: «Памятка после процедуры» — выбрать и убрать', async () => {
  const sent = backend()
  window.location.hash = '/settings/services'
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Удаление зуба' }))
  const panel = screen.getByRole('complementary', { name: 'Услуга' })
  const select = await within(panel).findByRole('combobox', { name: /Памятка после процедуры/ })
  expect(select).toHaveAttribute('data-value', '1')
  await choose(select, 'После отбеливания')
  await vi.waitFor(() => expect(sent).toContainEqual({ link: 5, memoId: 2 }))
  await choose(select, 'Без памятки')
  await vi.waitFor(() => expect(sent).toContainEqual({ link: 5, memoId: null }))
})

test('вкладка «Кыргызский»: перевод Tish, «✨ Перевести с ИИ» кладёт перевод в поля, сохраняется с памяткой', async () => {
  const sent = backend()
  const asked: unknown[] = []
  server.use(
    http.get('*/api/care-memos', () => HttpResponse.json([
      { id: 1, title: 'После удаления зуба', body: '• Держите тампон.', active: true, standard: true, serviceIds: [5],
        titleKy: 'Тиш жулдургандан кийин', bodyKy: '• Тампонду кармаңыз.', kyStandard: true },
      { id: 2, title: 'После отбеливания', body: '• Белая диета 48 часов.', active: true, standard: false, serviceIds: [] },
    ] satisfies Memo[])),
    http.get('*/api/clinic/visit-report-ai', () => HttpResponse.json({ available: true, on: true })),
    http.post('*/api/care-memos/translate', async ({ request }) => {
      asked.push(await request.json())
      return HttpResponse.json({ title: 'Агартуудан кийин', body: '• 48 саат «ак диета».' } satisfies Schemas['MemoTranslationsTranslation'])
    }),
  )
  window.location.hash = '/settings/memos'
  renderApp()
  const list = await screen.findByRole('list', { name: 'Памятки' })

  // Стандартная нетронутая — перевод Tish уже в полях
  await userEvent.click(within(list).getByRole('button', { name: '📋 После удаления зуба' }))
  let panel = screen.getByRole('complementary', { name: 'Памятка' })
  await userEvent.click(within(panel).getByRole('button', { name: 'Кыргызский' }))
  expect(within(panel).getByLabelText('Название по-кыргызски')).toHaveValue('Тиш жулдургандан кийин')
  expect(within(panel).getByLabelText('Текст по-кыргызски')).toHaveValue('• Тампонду кармаңыз.')
  expect(panel).toHaveTextContent('Перевод Tish стандартной памятки')
  await userEvent.click(within(panel).getByRole('button', { name: 'Закрыть' }))

  // Своя без перевода: пусто — уйдёт русский; ИИ переводит русский текст из редактора
  await userEvent.click(within(list).getByRole('button', { name: '📋 После отбеливания' }))
  panel = screen.getByRole('complementary', { name: 'Памятка' })
  await userEvent.type(within(panel).getByLabelText('Текст для пациента'), ' Без кофе.')
  await userEvent.click(within(panel).getByRole('button', { name: 'Кыргызский' }))
  expect(within(panel).getByLabelText('Текст по-кыргызски')).toHaveValue('')
  expect(panel).toHaveTextContent('будет отправлен русский текст')
  await userEvent.click(within(panel).getByRole('button', { name: '✨ Перевести с ИИ' }))
  expect(await within(panel).findByDisplayValue('Агартуудан кийин')).toBeInTheDocument()
  expect(within(panel).getByLabelText('Текст по-кыргызски')).toHaveValue('• 48 саат «ак диета».')
  expect(asked).toEqual([{ title: 'После отбеливания', body: '• Белая диета 48 часов. Без кофе.' }])
  // Сам перевод не сохранился — сохраняет сотрудник
  expect(sent).toEqual([])
  await userEvent.click(within(panel).getByRole('button', { name: 'Сохранить' }))
  expect(await within(panel).findByText('Памятка сохранена')).toBeInTheDocument()
  expect(sent).toContainEqual({ id: 2, title: 'После отбеливания', body: '• Белая диета 48 часов. Без кофе.', active: true,
    titleKy: 'Агартуудан кийин', bodyKy: '• 48 саат «ак диета».' })
})

test('ИИ клиники выключен — кнопки «Перевести с ИИ» нет, подсказка, где включить', async () => {
  backend()
  server.use(http.get('*/api/clinic/visit-report-ai', () => HttpResponse.json({ available: true, on: false })))
  window.location.hash = '/settings/memos'
  renderApp()
  const list = await screen.findByRole('list', { name: 'Памятки' })
  await userEvent.click(within(list).getByRole('button', { name: '📋 После отбеливания' }))
  const panel = screen.getByRole('complementary', { name: 'Памятка' })
  await userEvent.click(within(panel).getByRole('button', { name: 'Кыргызский' }))
  expect(await within(panel).findByText(/когда администратор включит ИИ клиники/)).toBeInTheDocument()
  expect(within(panel).queryByRole('button', { name: '✨ Перевести с ИИ' })).not.toBeInTheDocument()
})
