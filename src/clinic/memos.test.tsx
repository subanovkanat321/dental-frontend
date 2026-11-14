import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { choose } from '../test/select'
import { waitForSlow } from '../test/wait'

type Memo = Schemas['CareMemosCareMemoView']

function backend(who: Schemas['BookingViewsMe'] = me) {
  let memos: Memo[] = [
    { id: 1, title: 'После удаления зуба', body: '• Держите тампон.\n\nЗвоните в клинику: {телефон}.', active: true, standard: true, serviceIds: [5], kyStandard: false },
    { id: 2, title: 'После отбеливания', body: '• Белая диета 48 часов.', active: true, standard: true, serviceIds: [], kyStandard: false },
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
      const memo = { id: 3, title: body.title, body: body.body, active: true, standard: false, serviceIds: [], kyStandard: false }
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
  expect(within(list).getAllByRole('listitem')[1]).toHaveTextContent('не привязана к услугам прайса')

  await userEvent.click(within(list).getByRole('button', { name: 'После отбеливания' }))
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
  expect(await within(list).findByRole('button', { name: 'После брекетов' })).toBeInTheDocument()
})

test('регистратура памятки только читает', async () => {
  backend({ ...me, admin: false, doctorId: undefined, reception: true })
  window.location.hash = '/settings/memos'
  renderApp()
  const list = await screen.findByRole('list', { name: 'Памятки' })
  expect(screen.queryByRole('button', { name: '＋ Своя памятка' })).not.toBeInTheDocument()
  await userEvent.click(within(list).getByRole('button', { name: 'После удаления зуба' }))
  const panel = screen.getByRole('complementary', { name: 'Памятка' })
  expect(panel).toHaveTextContent('Памятки меняют руководитель и врачи.')
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
  await waitForSlow(() => expect(sent).toContainEqual({ link: 5, memoId: 2 }))
  await choose(select, 'Без памятки')
  await waitForSlow(() => expect(sent).toContainEqual({ link: 5, memoId: null }))
})

test('вкладка «Кыргызский»: перевод Tish, «✨ Перевести с ИИ» кладёт перевод в поля, сохраняется с памяткой', async () => {
  const sent = backend()
  const asked: unknown[] = []
  server.use(
    http.get('*/api/care-memos', () => HttpResponse.json([
      { id: 1, title: 'После удаления зуба', body: '• Держите тампон.', active: true, standard: true, serviceIds: [5],
        titleKy: 'Тиш жулдургандан кийин', bodyKy: '• Тампонду кармаңыз.', kyStandard: true },
      { id: 2, title: 'После отбеливания', body: '• Белая диета 48 часов.', active: true, standard: false, serviceIds: [], kyStandard: false },
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
  await userEvent.click(within(list).getByRole('button', { name: 'После удаления зуба' }))
  let panel = screen.getByRole('complementary', { name: 'Памятка' })
  await userEvent.click(within(panel).getByRole('button', { name: 'Кыргызский' }))
  expect(within(panel).getByLabelText('Название по-кыргызски')).toHaveValue('Тиш жулдургандан кийин')
  expect(within(panel).getByLabelText('Текст по-кыргызски')).toHaveValue('• Тампонду кармаңыз.')
  expect(panel).toHaveTextContent('Перевод Tish стандартной памятки')
  await userEvent.click(within(panel).getByRole('button', { name: 'Закрыть' }))

  // Своя без перевода: пусто — уйдёт русский; ИИ переводит русский текст из редактора
  await userEvent.click(within(list).getByRole('button', { name: 'После отбеливания' }))
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
  await userEvent.click(within(list).getByRole('button', { name: 'После отбеливания' }))
  const panel = screen.getByRole('complementary', { name: 'Памятка' })
  await userEvent.click(within(panel).getByRole('button', { name: 'Кыргызский' }))
  expect(await within(panel).findByText(/когда руководитель включит ИИ клиники/)).toBeInTheDocument()
  expect(within(panel).queryByRole('button', { name: '✨ Перевести с ИИ' })).not.toBeInTheDocument()
})

test('строка памятки: 2–3 услуги прайса и «и ещё N», скрытые услуги не показываем; «?» — в полосе вкладок', async () => {
  backend()
  const svc = (id: number, name: string, active = true) => ({ id, name, durationMinutes: 30, active })
  server.use(
    http.get('*/api/service-types', () => HttpResponse.json([
      svc(1, 'Удаление зуба'), svc(2, 'Удаление зуба сложное', false), svc(3, 'Удаление молочного зуба', false),
      svc(4, 'Удаление зуба мудрости'), svc(5, 'Удаление корня'), svc(6, 'Лечение кариеса'), svc(7, 'Лечение глубокого кариеса', false),
      svc(8, 'Пломба'), svc(9, 'Шинирование'), svc(10, 'Пульпит'),
    ] satisfies Schemas['ServiceTypeView'][])),
    http.get('*/api/care-memos', () => HttpResponse.json([
      { id: 1, title: 'После удаления зуба', body: '•', active: true, standard: true, serviceIds: [1, 2, 3, 4, 5], kyStandard: false },
      { id: 2, title: 'После лечения кариеса', body: '•', active: true, standard: true, serviceIds: [6, 7, 8, 9, 10], kyStandard: false },
      { id: 3, title: 'После отбеливания', body: '•', active: true, standard: true, serviceIds: [2, 3], kyStandard: false },
    ] satisfies Memo[])),
  )
  window.location.hash = '/settings/memos'
  renderApp()
  const list = await screen.findByRole('list', { name: 'Памятки' })
  const rows = within(list).getAllByRole('listitem')
  // Три услуги прайса — все три; скрытые («сложное», «молочного») не считаются
  expect(rows[0]).toHaveTextContent(/^После удаления зубаУдаление зуба, Удаление зуба мудрости, Удаление корня$/)
  // Четыре услуги прайса — две и «и ещё 2» (скрытая «глубокого кариеса» — не в счёт)
  expect(rows[1]).toHaveTextContent(/^После лечения кариесаЛечение кариеса, Пломба и ещё 2$/)
  expect(rows[1]).not.toHaveTextContent('глубокого')
  // Только скрытые услуги — как без услуг
  expect(rows[2]).toHaveTextContent(/^После отбеливанияне привязана к услугам прайса$/)
  // Иконки 📋 нет; строка открывается целиком
  expect(list).not.toHaveTextContent('📋')
  await userEvent.click(within(rows[1]!).getByText(/и ещё 2/))
  // В карточке — полный список услуг прайса
  const panel = screen.getByRole('complementary', { name: 'Памятка' })
  expect(within(panel).getByLabelText('Услуги памятки')).toHaveTextContent('Предложим после: Лечение кариеса, Пломба, Шинирование, Пульпит.')
  expect(panel).not.toHaveTextContent('глубокого')

  // «?» — в полосе вкладок «Настроек», а не своей строкой над «＋ Своя памятка»
  const tabs = screen.getByRole('navigation', { name: 'Подразделы: Настройки' })
  expect(within(tabs).getByRole('button', { name: 'Подсказка: Памятки' })).toBeInTheDocument()
  expect(document.querySelector('.head-tools-inline .help-hint, .page-head .help-hint')).toBeNull()
})
