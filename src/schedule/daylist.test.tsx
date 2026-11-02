import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import { slotInstant, todayIn } from '../lib/time'
import { appointment, me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

/** Телефон: экран уже 760px — «День» списком. */
beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('max-width'), media: query, addEventListener() {}, removeEventListener() {}, onchange: null,
    addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }))
})
afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

const at = (time: string) => slotInstant(todayIn(), Number(time.slice(0, 2)) * 60 + Number(time.slice(3)))

function backend() {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', ({ request }) => {
      const doctorId = Number(new URL(request.url).searchParams.get('doctorId'))
      return HttpResponse.json(doctorId === 1 ? [appointment(10, 1, '10:00', 'Бакыт М.')] : [appointment(11, 2, '12:00', 'Нурлан К.')])
    }),
    http.get('*/api/appointments/counts', () => HttpResponse.json([])),
    http.get('*/api/slots', ({ request }) => {
      const doctorId = Number(new URL(request.url).searchParams.get('doctorId'))
      return HttpResponse.json({
        workingDay: true, breaks: [],
        free: doctorId === 1 ? [{ start: at('13:00'), end: at('15:00') }] : [{ start: at('09:00'), end: at('12:00') }],
      })
    }),
  )
}

test('телефон, «Все врачи» — список: приёмы обоих врачей и свободные окна с именем врача', async () => {
  backend()
  localStorage.setItem('crm.schedule.view', 'all')
  renderApp()
  // Как в прежнем приложении: открывается свой день, даже если в прошлый раз смотрели всех
  expect(await screen.findByRole('button', { name: /10:00–10:30, Бакыт М\./ })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /12:00–12:30, Нурлан К\./ })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: /^Чьё расписание: Айгерим Садыкова/ }))
  const options = screen.getByRole('listbox', { name: 'Чьё расписание' })
  expect(within(options).getAllByRole('option').map((o) => o.querySelector('strong')?.textContent)).toEqual(['Айгерим Садыкова (я)', 'Дастан Т.', 'Все врачи'])
  await userEvent.click(within(options).getByRole('option', { name: /Все врачи/ }))
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  expect(await screen.findByRole('button', { name: /12:00–12:30, Нурлан К\./ })).toBeInTheDocument()
  expect(screen.queryByRole('group', { name: 'Дастан Т.' })).not.toBeInTheDocument() // не сетка
  // Верх на телефоне — без повторов: один день крупно, одна «Новая запись» рядом с «Без записи»
  expect(screen.getAllByRole('button', { name: 'Предыдущий день' })).toHaveLength(1)
  expect(screen.getAllByRole('button', { name: '＋ Новая запись' })).toHaveLength(1)
  expect(screen.getByRole('button', { name: 'Принять сейчас (без записи)' })).toBeInTheDocument()
  expect(screen.getByLabelText('Выбрать дату')).toBeInTheDocument()
  // У каждого врача свой блок: приём Нурлана — в блоке Дастана, не в общем списке
  const dastan = screen.getByRole('region', { name: 'Дастан Т.' })
  expect(within(dastan).getByRole('button', { name: /12:00–12:30, Нурлан К\./ })).toBeInTheDocument()
  expect(within(dastan).queryByRole('button', { name: /10:00–10:30, Бакыт М\./ })).not.toBeInTheDocument()
  expect(within(screen.getByRole('region', { name: 'Айгерим Садыкова' })).getByRole('button', { name: /10:00–10:30, Бакыт М\./ })).toBeInTheDocument()

  await userEvent.click(screen.getByRole('button', { name: /Свободно с 09:00 до 12:00 у врача Дастан/ }))
  const panel = screen.getByRole('complementary', { name: 'Новая запись' })
  expect(within(panel).getByLabelText('Врач')).toHaveValue('2')
})

test('телефон, один врач — только его приёмы и окна', async () => {
  backend()
  localStorage.setItem('crm.schedule.view', '1')
  renderApp()
  expect(await screen.findByRole('button', { name: /10:00–10:30, Бакыт М\./ })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /12:00–12:30, Нурлан К\./ })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Свободно с 13:00 до 15:00, записать/ })).toBeInTheDocument()
})

test('телефон в Telegram — «＋ Новая запись» кнопкой на экране, рядом с «Без записи»', async () => {
  backend()
  vi.stubGlobal('Telegram', { WebApp: { initData: 'query_id=test', platform: 'ios', ready() {}, expand() {} } })
  try {
    renderApp()
    expect(await screen.findByRole('button', { name: /10:00–10:30, Бакыт М\./ })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '＋ Новая запись' }))
    expect(await screen.findByRole('complementary', { name: 'Новая запись' })).toBeInTheDocument()
  } finally {
    vi.unstubAllGlobals()
  }
})

test('телефон: вместо ленты — один день; стрелка — «Завтра», «Сегодня» — назад', async () => {
  backend()
  renderApp()
  const bar = await screen.findByRole('group', { name: 'День' })
  expect(within(bar).getByText('Сегодня')).toBeInTheDocument()
  expect(within(bar).queryByRole('button', { name: 'Сегодня' })).not.toBeInTheDocument()
  await userEvent.click(within(bar).getByRole('button', { name: 'Следующий день' }))
  expect(within(bar).getByText('Завтра')).toBeInTheDocument()
  await userEvent.click(within(bar).getByRole('button', { name: 'Сегодня' }))
  expect(within(bar).getByText('Сегодня')).toBeInTheDocument()
  expect(within(bar).queryByRole('button', { name: 'Сегодня' })).not.toBeInTheDocument()
})
