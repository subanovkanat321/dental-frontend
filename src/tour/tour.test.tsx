import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { Tour } from './Tour'
import { tourSteps } from './steps'
import { waitForSlow } from '../test/wait'

/**
 * Тур при первом входе: показан тому, кто его не видел (сервер: seenAt = null), не показан тому, кто
 * прошёл; «Пропустить» и «Готово» шлют отметку; шаги — по роли и устройству; «Пройти тур ещё раз» в
 * «Помощи». По умолчанию в тестах тур пройден (test/server.ts) — здесь явно «не видел». Данные вымышленные.
 */

type Me = Schemas['BookingViewsMe']

const reception: Me = { ...me, admin: false, reception: true, doctorId: undefined, fullName: 'Айпери' }
const assistant: Me = { ...me, admin: false, reception: false, doctorId: undefined, assistantOf: [1], fullName: 'Асель' }
const doctor: Me = { ...me, admin: false, reception: false, doctorId: 2, fullName: 'Дастан' }

function phone() {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width: 760px'), addEventListener() {}, removeEventListener() {} }))
}

/** Сервер: тур не видел; PUT — считаем отметки. */
function unseen(who: Me = me) {
  const marks: string[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(who)),
    http.get('*/api/appointments', () => HttpResponse.json([])),
    http.get('*/api/me/tour', () => HttpResponse.json({} satisfies Schemas['StaffTourTourView'])),
    http.put('*/api/me/tour', () => {
      marks.push('seen')
      return HttpResponse.json({ seenAt: '2026-11-11T05:00:00Z' } satisfies Schemas['StaffTourTourView'])
    }),
  )
  return marks
}

const dialog = () => screen.findByRole('dialog', { name: /./, description: /./ }, { timeout: 5000 })
const titleOf = (d: HTMLElement) => within(d).getByRole('heading').textContent

beforeEach(() => {
  // Плашку «Заполните профиль» (у врача без фото) уже закрыли — иначе тур ждёт её (свой тест ниже)
  localStorage.setItem('crm.profile-notice.hidden', '1')
})

afterEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

test('новый сотрудник (компьютер, руководитель): тур из 6 шагов; вкладки показывает в «Пациентах», в конце — обратно; «Готово» шлёт отметку', async () => {
  const marks = unseen()
  renderApp()
  let d = await dialog()
  expect(titleOf(d)).toBe('Расписание — здесь день клиники')
  expect(d).toHaveTextContent('1 из 6')
  expect(d).toHaveAttribute('aria-modal', 'true')
  // Фокус — в пузыре, на «Дальше»
  expect(within(d).getByRole('button', { name: 'Дальше' })).toHaveFocus()
  // Подсвечен элемент меню «Расписание»
  expect(document.querySelector('.tour')).toHaveAttribute('data-tour-step', 'schedule')

  await userEvent.click(within(d).getByRole('button', { name: 'Дальше' }))
  d = await dialog()
  expect(titleOf(d)).toBe('＋ Новая запись')
  expect(d).toHaveTextContent('2 из 6')
  await userEvent.click(within(d).getByRole('button', { name: 'Дальше' }))
  expect(titleOf(await dialog())).toBe('Пациенты')
  await userEvent.click(within(await dialog()).getByRole('button', { name: 'Дальше' }))
  // Вкладки подразделов — тур сам открыл «Пациентов»
  await waitForSlow(() => expect(titleOf(screen.getByRole('dialog', { description: /./ }))).toBe('Вкладки подразделов'), { timeout: 5000 })
  expect(window.location.hash).toBe('#/patients')
  expect(screen.getByRole('navigation', { name: 'Подразделы: Пациенты' })).toBeInTheDocument()
  await userEvent.keyboard('{ArrowRight}')
  d = await dialog()
  expect(titleOf(d)).toBe('Касса')
  expect(d).toHaveTextContent('Деньги клиники')
  await userEvent.keyboard('{Enter}')
  d = await dialog()
  expect(titleOf(d)).toBe('Помощь — если что-то непонятно')
  expect(d).toHaveTextContent('6 из 6')
  expect(d).toHaveTextContent('короткие видео «Как сделать в Tish», группа врачей Tish')
  expect(within(d).queryByRole('button', { name: 'Пропустить' })).not.toBeInTheDocument()
  expect(marks).toEqual([])
  await userEvent.click(within(d).getByRole('button', { name: 'Готово' }))
  expect(screen.queryByRole('dialog', { description: /./ })).not.toBeInTheDocument()
  await waitForSlow(() => expect(marks).toEqual(['seen']))
  // Вернулись туда, где были до тура
  expect(window.location.hash).toBe('#/schedule')
})

test('«Пропустить» закрывает тур и шлёт отметку; Esc — то же самое', async () => {
  const marks = unseen()
  const view = renderApp()
  const d = await dialog()
  await userEvent.click(within(d).getByRole('button', { name: 'Пропустить' }))
  expect(screen.queryByRole('dialog', { description: /./ })).not.toBeInTheDocument()
  await waitForSlow(() => expect(marks).toEqual(['seen']))
  view.unmount()

  // Новый запуск, снова «не видел» — Esc
  const marks2 = unseen()
  renderApp()
  await dialog()
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('dialog', { description: /./ })).not.toBeInTheDocument()
  await waitForSlow(() => expect(marks2).toEqual(['seen']))
})

test('кто уже прошёл тур — не видит его; «Помощь → Пройти тур ещё раз» показывает снова, отметку повторно не шлёт', async () => {
  const marks: string[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', () => HttpResponse.json([])),
    http.put('*/api/me/tour', () => {
      marks.push('seen')
      return HttpResponse.json({ seenAt: '2026-11-01T06:00:00Z' })
    }),
  )
  renderApp()
  await screen.findByRole('navigation', { name: 'Разделы' })
  await new Promise((r) => setTimeout(r, 1000))
  expect(screen.queryByRole('dialog', { description: /./ })).not.toBeInTheDocument()

  await userEvent.click(screen.getByRole('button', { name: 'Помощь' }))
  await userEvent.click(within(screen.getByRole('dialog', { name: 'Помощь' })).getByRole('button', { name: /^Пройти тур ещё раз/ }))
  const d = await dialog()
  expect(titleOf(d)).toBe('Расписание — здесь день клиники')
  await userEvent.click(within(d).getByRole('button', { name: 'Пропустить' }))
  expect(screen.queryByRole('dialog', { description: /./ })).not.toBeInTheDocument()
  await new Promise((r) => setTimeout(r, 100))
  expect(marks).toEqual([])
})

test('телефон, регистратура: нижнее меню — «Касса» (к оплате) и в конце «Ещё: профиль и Помощь»', async () => {
  phone()
  unseen(reception)
  renderApp()
  let d = await dialog()
  expect(titleOf(d)).toBe('Расписание — здесь день клиники')
  expect(d).toHaveTextContent('отправить на кассу')
  const titles = [titleOf(d)]
  for (let i = 0; i < 5; i++) {
    await userEvent.click(within(d).getByRole('button', { name: 'Дальше' }))
    await waitForSlow(() => expect(titleOf(screen.getByRole('dialog', { description: /./ }))).not.toBe(titles.at(-1)), { timeout: 5000 })
    d = screen.getByRole('dialog', { description: /./ })
    titles.push(titleOf(d))
  }
  expect(titles).toEqual(['Расписание — здесь день клиники', '＋ Новая запись', 'Пациенты', 'Вкладки подразделов', 'Касса', 'Ещё: профиль и Помощь'])
  expect(d).toHaveTextContent('6 из 6')
  expect(document.querySelector('.tour')).toHaveAttribute('data-tour-step', 'more')
  expect(within(d).getByRole('button', { name: 'Готово' })).toBeInTheDocument()
})

test('тур — первым: плашки «Заполните профиль» нет, пока тур не пройден; прошли — плашка появилась', async () => {
  localStorage.removeItem('crm.profile-notice.hidden')
  unseen(reception)
  server.use(http.get('*/api/me/name', () => HttpResponse.json({ fullName: '', editable: true } satisfies Schemas['StaffMembersOwnName'])))
  renderApp()
  const d = await dialog()
  expect(titleOf(d)).toBe('Расписание — здесь день клиники')
  expect(screen.queryByRole('region', { name: 'Заполните профиль' })).not.toBeInTheDocument()
  await userEvent.click(within(d).getByRole('button', { name: 'Пропустить' }))
  expect(await screen.findByRole('region', { name: 'Заполните профиль' })).toBeInTheDocument()
})

test('команде платформы без клиники тур не показываем', async () => {
  const marks: string[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json({ doctor: false, platform: true, owner: true, fullName: 'Команда', admin: false, reception: false, bookingEnabled: false, daysAhead: 0, canChangeClinic: false, waiting: false, hasReception: false, hasCard: false, maxRelatives: 6 } satisfies Me)),
    http.get('*/api/me/tour', () => { marks.push('get'); return HttpResponse.json({}) }),
    http.get('*/api/platform/*', () => HttpResponse.json([])),
  )
  renderApp()
  await screen.findByRole('navigation', { name: 'Разделы' })
  await new Promise((r) => setTimeout(r, 1000))
  expect(screen.queryByRole('dialog', { description: /./ })).not.toBeInTheDocument()
  expect(marks).toEqual([])
})

test('шаги по роли и устройству', () => {
  const ids = (m: Me, p: boolean) => tourSteps(m, p).map((s) => s.id)
  expect(ids(me, false)).toEqual(['schedule', 'new', 'patients', 'tabs', 'cash', 'help'])
  expect(ids(me, true)).toEqual(['schedule', 'new', 'patients', 'tabs', 'cash', 'more'])
  // Ассистент денег не видит — «Кассы» нет
  expect(ids(assistant, false)).toEqual(['schedule', 'new', 'patients', 'tabs', 'help'])
  expect(ids(assistant, true)).toEqual(['schedule', 'new', 'patients', 'tabs', 'more'])
  // «Касса» — что в ней у этого человека
  expect(tourSteps(reception, false).find((s) => s.id === 'cash')?.text).toMatch(/ждёт оплаты на кассе/)
  expect(tourSteps(doctor, false).find((s) => s.id === 'cash')?.text).toMatch(/Мой заработок/)
  expect(tourSteps(doctor, false)[0]!.title).toBe('Расписание — здесь ваш день')
  expect(tourSteps(assistant, false)[0]!.title).toBe('Расписание — день ваших врачей')
  // Компьютер: последний шаг — «Помощь» и профиль под ней; телефон — «Ещё»
  expect(tourSteps(me, false).at(-1)!.target).toEqual(['help', 'me'])
  expect(tourSteps(me, true).at(-1)!.target).toEqual(['more'])
  // В Telegram «Выйти» нет — о нём не пишем
  expect(tourSteps(me, true, true).at(-1)!.text).not.toMatch(/выход/)
  expect(tourSteps(me, true, false).at(-1)!.text).toMatch(/выход/)
  for (const m of [me, reception, assistant, doctor]) {
    for (const p of [false, true]) {
      const n = tourSteps(m, p).length
      expect(n).toBeGreaterThanOrEqual(4)
      expect(n).toBeLessThanOrEqual(6)
    }
  }
})

test('шаг без элемента на экране пропускается; Назад, Tab по кругу в пузыре', async () => {
  const done = vi.fn()
  render(
    <div>
      <button type="button" data-tour="a">А</button>
      <div hidden><button type="button" data-tour="b">Б</button></div>
      <button type="button" data-tour="c">В</button>
    </div>,
  )
  render(<Tour page="schedule" onDone={done} steps={[
    { id: 'a', target: ['a'], title: 'Первый', text: 'Текст первого' },
    { id: 'b', target: ['b'], title: 'Скрытый', text: 'Его не видно' },
    { id: 'c', target: ['c'], title: 'Третий', text: 'Текст третьего' },
  ]} />)
  let d = await dialog()
  expect(titleOf(d)).toBe('Первый')
  expect(d).toHaveTextContent('1 из 3')
  await userEvent.keyboard('{Enter}')
  // «Скрытый» не нашёлся — тур идёт к третьему, счётчик уменьшился
  await waitForSlow(() => expect(titleOf(screen.getByRole('dialog', { description: /./ }))).toBe('Третий'), { timeout: 5000 })
  d = screen.getByRole('dialog', { description: /./ })
  expect(d).toHaveTextContent('2 из 2')
  expect(screen.getByText(/Подсказка 2 из 2: Третий/)).toHaveAttribute('aria-live', 'polite')
  // Фокус не уходит под затемнение
  expect(within(d).getByRole('button', { name: 'Готово' })).toHaveFocus()
  await userEvent.tab()
  expect(within(d).getByRole('button', { name: 'Назад' })).toHaveFocus()
  await userEvent.tab()
  expect(within(d).getByRole('button', { name: 'Готово' })).toHaveFocus()
  await userEvent.keyboard('{ArrowLeft}')
  expect(titleOf(await dialog())).toBe('Первый')
  expect(done).not.toHaveBeenCalled()
  await userEvent.keyboard('{Escape}')
  expect(done).toHaveBeenCalledTimes(1)
})
