import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { appointment, me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { waitForSlow } from '../test/wait'
import { teethSaid } from './dictationCheat'

// Вымышленный пациент
const visit: Schemas['AppointmentView'] = appointment(10, 1, '00:05', 'Бакыт М.', { status: 'DONE', version: 1 })

const proposal: Schemas['VisitDictationProposal'] = {
  teeth: [
    { tooth: 36, state: 'FILLING', surfaces: ['O', 'D'], note: 'светоотверждаемая', was: 'CARIES' },
    { tooth: 18, state: 'MISSING', was: 'HEALTHY' },
  ],
  plan: [{ tooth: 46, title: 'Лечение каналов' }, { tooth: 21, title: 'Коронка' }],
  note: 'Кариес 36 — пломба. Удалён 18.',
  next: { inDays: 7, text: 'через неделю, каналы 46' },
}

function backend(parse: () => Response) {
  const calls: { parse: unknown[]; apply: unknown[] } = { parse: [], apply: [] }
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', ({ request }) => HttpResponse.json(
      Number(new URL(request.url).searchParams.get('doctorId')) === 1 ? [visit] : [])),
    http.get('*/api/appointments/:id/note', () => HttpResponse.json({ note: 'Анестезия без реакции' })),
    http.post('*/api/appointments/:id/dictation/parse', async ({ request }) => {
      calls.parse.push(await request.json())
      return parse()
    }),
    http.post('*/api/appointments/:id/dictation/apply', async ({ request }) => {
      const body = await request.json() as Schemas['VisitDictationApply']
      calls.apply.push(body)
      return HttpResponse.json({ teeth: [], plan: [], note: body.note } satisfies Schemas['VisitDictationApplied'])
    }),
  )
  return calls
}

/** Поддельное распознавание речи: тест сам «говорит» через say(). */
class FakeRecognition {
  static last: FakeRecognition | null = null
  static count = 0
  lang = ''
  continuous = false
  interimResults = false
  onresult: ((e: unknown) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  onend: (() => void) | null = null
  started = false
  constructor() { FakeRecognition.last = this; FakeRecognition.count++ }
  start() { this.started = true }
  stop() { this.started = false; this.onend?.() }
  say(parts: [string, boolean][]) {
    const results = parts.map(([transcript, isFinal]) => ({ isFinal, 0: { transcript } }))
    act(() => this.onresult?.({ resultIndex: 0, results }))
  }
  /** Браузер сам закончил распознавание (тишина), никто «Пауза» не нажимал. */
  silence() { act(() => { this.started = false; this.onend?.() }) }
}

async function openPanel() {
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: /Бакыт М\./ }))
  return screen.findByRole('button', { name: '🎤 Надиктовать' })
}

afterEach(() => {
  vi.unstubAllGlobals()
  FakeRecognition.last = null
  FakeRecognition.count = 0
})

test('диктовка голосом: текст по мере речи, разбор, снять галочку, поправить, сохранить только выбранное', async () => {
  vi.stubGlobal('webkitSpeechRecognition', FakeRecognition)
  const calls = backend(() => HttpResponse.json(proposal))
  await userEvent.click(await openPanel())
  const rec = FakeRecognition.last!
  expect(rec.started).toBe(true)
  expect(rec.lang).toBe('ru-RU')
  expect(rec.continuous && rec.interimResults).toBe(true)
  // Поле заметки спрятано, пока идёт диктовка
  expect(screen.queryByRole('form', { name: 'Заметка о приёме' })).not.toBeInTheDocument()

  const box = screen.getByRole('region', { name: 'Диктовка' })
  rec.say([['36-й кариес, поставили пломбу.', true], [' удалили', false]])
  expect(within(box).getByRole('textbox', { name: 'Текст диктовки' })).toHaveValue('36-й кариес, поставили пломбу. удалили')
  rec.say([['36-й кариес, поставили пломбу.', true], [' Удалили 18.', true]])
  await userEvent.click(within(box).getByRole('button', { name: 'Готово' }))
  expect(calls.parse).toEqual([{ text: '36-й кариес, поставили пломбу. Удалили 18.' }])

  const review = await screen.findByRole('region', { name: 'Проверьте диктовку' })
  expect(review).toHaveTextContent('было: кариес')
  expect(review).toHaveTextContent('Следующий визит: через неделю, каналы 46')
  expect(within(review).getByRole('textbox', { name: 'Заметка из диктовки' }))
    .toHaveValue('Анестезия без реакции\nКариес 36 — пломба. Удалён 18.')
  // Удаление 18 врач не подтверждает, коронку 21 — тоже; пометку к 36 правит
  await userEvent.click(within(review).getByRole('checkbox', { name: 'Зуб 18: применить' }))
  await userEvent.click(within(review).getByRole('checkbox', { name: 'В план: Коронка' }))
  const mark = within(review).getByRole('textbox', { name: 'Пометка к зубу 36' })
  await userEvent.clear(mark)
  await userEvent.type(mark, 'композит')
  // Поверхности, которые назвал врач, — стандартной записью
  expect(within(review).getByRole('button', { name: 'Убрать поверхности зуба 36: ОД' })).toHaveTextContent('ОД ✕')
  expect(calls.apply).toEqual([])
  await userEvent.click(within(review).getByRole('button', { name: 'Сохранить' }))

  expect(await screen.findByRole('status')).toHaveTextContent('Сохранено в медкарту · зубов: 1 · шагов плана: 1')
  expect(calls.apply).toEqual([{
    teeth: [{ tooth: 36, state: 'FILLING', surfaces: ['O', 'D'], note: 'композит' }],
    plan: [{ tooth: 46, title: 'Лечение каналов' }],
    note: 'Анестезия без реакции\nКариес 36 — пломба. Удалён 18.',
  }])
})

test('без распознавания речи — поле для текста; ИИ для диктовки выключен клиникой — текст идёт в заметку', async () => {
  const calls = backend(() => HttpResponse.json(
    { type: 'about:blank', title: 'Conflict', status: 409, detail: 'ИИ для диктовки выключен — включите в «Настройки → ИИ-помощник» (руководитель клиники) или запишите заметку текстом', code: 'ai-unavailable' },
    { status: 409, headers: { 'Content-Type': 'application/problem+json' } }))
  await userEvent.click(await openPanel())
  const box = screen.getByRole('region', { name: 'Диктовка' })
  expect(box).toHaveTextContent('микрофон на клавиатуре')
  const field = within(box).getByPlaceholderText('Вставьте или напишите текст')
  await userEvent.type(field, 'Пломба на 36')
  await userEvent.click(within(box).getByRole('button', { name: 'Разобрать' }))

  const review = await screen.findByRole('region', { name: 'Проверьте диктовку' })
  expect(review).toHaveTextContent('ИИ для диктовки выключен — включите в «Настройки → ИИ-помощник» (руководитель клиники) или запишите заметку текстом')
  expect(review).toHaveTextContent('Текст добавлен в заметку.')
  expect(within(review).queryByRole('checkbox')).not.toBeInTheDocument()
  expect(within(review).getByRole('textbox', { name: 'Заметка из диктовки' })).toHaveValue('Анестезия без реакции\nПломба на 36')
  await userEvent.click(within(review).getByRole('button', { name: 'Сохранить' }))
  await waitForSlow(() => expect(calls.apply).toEqual([{ teeth: [], plan: [], note: 'Анестезия без реакции\nПломба на 36' }]))
})

test('регистратуре кнопки нет: заметка о приёме ей закрыта (403)', async () => {
  backend(() => HttpResponse.json(proposal))
  server.use(http.get('*/api/appointments/:id/note', () => HttpResponse.json(
    { status: 403, detail: 'Заметки о лечении видят врач приёма и руководитель' },
    { status: 403, headers: { 'Content-Type': 'application/problem+json' } })))
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: /Бакыт М\./ }))
  await waitForSlow(() => expect(screen.queryByText('Заметка о приёме')).not.toBeInTheDocument())
  expect(screen.queryByRole('button', { name: '🎤 Надиктовать' })).not.toBeInTheDocument()
})

test('тишина не обрывает запись: браузер закончил сам — тихо начинаем заново, текст на месте; шпаргалка отмечает сказанное', async () => {
  vi.stubGlobal('webkitSpeechRecognition', FakeRecognition)
  const calls = backend(() => HttpResponse.json(proposal))
  await userEvent.click(await openPanel())
  const box = screen.getByRole('region', { name: 'Диктовка' })
  const cheat = within(box).getByRole('list', { name: 'Что сказать по порядку' })
  const items = within(cheat).getAllByRole('listitem')
  expect(items).toHaveLength(5)
  expect(cheat).toHaveTextContent('Тридцать шестой зуб — кариес')
  expect(items.filter((li) => li.textContent?.includes('✓'))).toHaveLength(0)
  expect(box).toHaveTextContent('Слушаю… можно думать, запись не прервётся')

  const first = FakeRecognition.last!
  first.say([['Тридцать шестой зуб кариес', true], [' поставили', false]])
  expect(items[0]).toHaveTextContent('✓')
  expect(items[0]).toHaveTextContent('сказано')
  // Врач задумался — браузер закончил сам; недоговорённое слово не потерялось
  first.silence()
  const second = FakeRecognition.last!
  expect(second).not.toBe(first)
  expect(second.started).toBe(true)
  expect(box).toHaveTextContent('Слушаю…')
  expect(within(box).getByRole('button', { name: 'Пауза' })).toBeInTheDocument()
  second.say([['пломбу. Контроль через две недели', true]])
  expect(within(box).getByRole('textbox', { name: 'Текст диктовки' }))
    .toHaveValue('Тридцать шестой зуб кариес поставили пломбу. Контроль через две недели')
  expect(items[1]).toHaveTextContent('✓')
  expect(items[4]).toHaveTextContent('✓')
  expect(items[2]).not.toHaveTextContent('✓')

  // «Готово»: запись останавливается, разбор — ровно один раз, без перезапуска
  const before = FakeRecognition.count
  await userEvent.dblClick(within(box).getByRole('button', { name: 'Готово' }))
  await screen.findByRole('region', { name: 'Проверьте диктовку' })
  expect(FakeRecognition.count).toBe(before)
  expect(calls.parse).toEqual([{ text: 'Тридцать шестой зуб кариес поставили пломбу. Контроль через две недели' }])
})

test('«Пауза» — без перезапуска; долго тихо — пауза с подсказкой «Продолжить»; разбор сам не начинается', async () => {
  vi.stubGlobal('webkitSpeechRecognition', FakeRecognition)
  const calls = backend(() => HttpResponse.json(proposal))
  await userEvent.click(await openPanel())
  const box = screen.getByRole('region', { name: 'Диктовка' })
  FakeRecognition.last!.say([['Сорок шестой каналы', true]])
  await userEvent.click(within(box).getByRole('button', { name: 'Пауза' }))
  expect(FakeRecognition.count).toBe(1)
  expect(FakeRecognition.last!.started).toBe(false)
  expect(box).toHaveTextContent('Запись на паузе')

  await userEvent.click(within(box).getByRole('button', { name: '🎤 Продолжить' }))
  expect(FakeRecognition.count).toBe(2)
  // Тишина: 5 перезапусков подряд без единого слова — дальше пауза
  for (let i = 0; i < 6; i++) FakeRecognition.last!.silence()
  expect(FakeRecognition.count).toBe(7)
  expect(box).toHaveTextContent('Долго тихо — запись на паузе')
  expect(within(box).getByRole('button', { name: '🎤 Продолжить' })).toBeInTheDocument()
  expect(within(box).getByRole('textbox', { name: 'Текст диктовки' })).toHaveValue('Сорок шестой каналы')
  expect(calls.parse).toEqual([])
})

test('нет доступа к микрофону — без перезапуска, поле для текста', async () => {
  vi.stubGlobal('webkitSpeechRecognition', FakeRecognition)
  backend(() => HttpResponse.json(proposal))
  await userEvent.click(await openPanel())
  const rec = FakeRecognition.last!
  act(() => rec.onerror?.({ error: 'not-allowed' }))
  rec.silence()
  expect(FakeRecognition.count).toBe(1)
  const box = screen.getByRole('region', { name: 'Диктовка' })
  expect(box).toHaveTextContent('Нет доступа к микрофону')
  expect(box).toHaveTextContent('микрофон на клавиатуре')
  expect(within(box).getByRole('list', { name: 'Что сказать по порядку' })).toBeInTheDocument()
})

test('номера зубов для шпаргалки: цифрами и словами, «через 14 дней» — не зуб', () => {
  expect([...teethSaid('36-й кариес, у 46 каналы')]).toEqual([36, 46])
  expect([...teethSaid('Тридцать шестой зуб, сорок шестой — каналы, одиннадцатый')].sort()).toEqual([11, 36, 46])
  expect(teethSaid('контроль через 14 дней').size).toBe(0)
  expect(teethSaid('зуб 9, 51, 19').size).toBe(0)
})
