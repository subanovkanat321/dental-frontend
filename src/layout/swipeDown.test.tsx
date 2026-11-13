import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef } from 'react'

import { ask } from '../lib/confirm'
import { MonthSheet } from '../schedule/month/MonthSheet'
import { ConfirmHost } from './Confirm'
import { Select } from './Select'
import { useSwipeDown } from './useSwipeDown'

/**
 * Свайп вниз по нижнему листу (useSwipeDown): палец — touch-события, время — подменённый Date
 * (по нему считается скорость: медленный жест не должен сойти за быстрый флик).
 */
const ID = 7
const pt = (x: number, y: number) => [{ identifier: ID, clientX: x, clientY: y }]
function later(ms: number) {
  vi.setSystemTime(new Date(Date.now() + ms))
}
/** Палец лёг в (x, y0), медленно провели до (x + dx, y0 + dy), отпустили */
function drag(el: Element, { x = 100, y0 = 20, dx = 0, dy }: { x?: number; y0?: number; dx?: number; dy: number }) {
  fireEvent.touchStart(el, { touches: pt(x, y0), changedTouches: pt(x, y0) })
  const steps = 6
  for (let i = 1; i <= steps; i++) {
    later(100)
    fireEvent.touchMove(el, { touches: pt(x + (dx * i) / steps, y0 + (dy * i) / steps), changedTouches: pt(x + (dx * i) / steps, y0 + (dy * i) / steps) })
  }
  later(100)
  fireEvent.touchEnd(el, { touches: [], changedTouches: pt(x + dx, y0 + dy) })
}

function Sheet({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useSwipeDown(ref, onClose)
  return (
    <div className="backdrop" style={{ backgroundColor: 'rgba(10, 25, 30, 0.4)' }}>
      <div ref={ref} data-testid="sheet" style={{ overflowY: 'auto' }}>
        <div data-testid="list" style={{ overflowY: 'auto' }}>
          <p>Пункт</p>
          <input aria-label="Поле" />
        </div>
      </div>
    </div>
  )
}

// В jsdom у листа нет размеров: высота — окно (768), порог — min(25%, 160px) = 160px.
// Палец по умолчанию кладём ниже шапки (GRIP 56px от верха листа = 0)
describe('useSwipeDown', () => {
  test('тянем вниз дальше порога — закрыть; лист едет за пальцем, фон тускнеет', () => {
    const onClose = vi.fn()
    render(<Sheet onClose={onClose} />)
    const sheet = screen.getByTestId('sheet')
    const item = screen.getByText('Пункт')
    fireEvent.touchStart(item, { touches: pt(100, 100), changedTouches: pt(100, 100) })
    later(100)
    fireEvent.touchMove(item, { touches: pt(100, 200), changedTouches: pt(100, 200) })
    expect(sheet.style.transform).toBe('translateY(100px)')
    expect(sheet.parentElement!.style.backgroundColor).toMatch(/rgba\(10, 25, 30, 0\.3/)
    later(100)
    fireEvent.touchMove(item, { touches: pt(100, 300), changedTouches: pt(100, 300) })
    later(100)
    fireEvent.touchEnd(item, { touches: [], changedTouches: pt(100, 300) })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('короткий медленный жест — лист возвращается на место', () => {
    const onClose = vi.fn()
    render(<Sheet onClose={onClose} />)
    drag(screen.getByText('Пункт'), { y0: 100, dy: 80 })
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByTestId('sheet').style.transform).toBe('')
  })

  test('быстрый флик закрывает и с коротким ходом', () => {
    const onClose = vi.fn()
    render(<Sheet onClose={onClose} />)
    const item = screen.getByText('Пункт')
    fireEvent.touchStart(item, { touches: pt(100, 100), changedTouches: pt(100, 100) })
    later(20)
    fireEvent.touchMove(item, { touches: pt(100, 130), changedTouches: pt(100, 130) })
    later(20)
    fireEvent.touchMove(item, { touches: pt(100, 170), changedTouches: pt(100, 170) })
    later(10)
    fireEvent.touchEnd(item, { touches: [], changedTouches: pt(100, 170) })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('список внутри прокручен — вниз это прокрутка, лист не закрываем; за шапку — закрываем', () => {
    const onClose = vi.fn()
    render(<Sheet onClose={onClose} />)
    const list = screen.getByTestId('list')
    Object.defineProperty(list, 'scrollTop', { value: 120, configurable: true })
    drag(screen.getByText('Пункт'), { y0: 100, dy: 300 })
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByTestId('sheet').style.transform).toBe('')
    // Верх листа (ручка, шапка) — тянуть можно всегда
    drag(screen.getByTestId('sheet'), { y0: 20, dy: 300 })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('вбок, вверх и с поля ввода — не наш жест', () => {
    const onClose = vi.fn()
    render(<Sheet onClose={onClose} />)
    const item = screen.getByText('Пункт')
    drag(item, { y0: 100, dx: 300, dy: 120 })
    drag(item, { y0: 400, dy: -300 })
    drag(screen.getByLabelText('Поле'), { y0: 100, dy: 300 })
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByTestId('sheet').style.transform).toBe('')
  })
})

const phone = () => vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('max-width'), addEventListener() {}, removeEventListener() {} }))

describe('подключено в листах', () => {
  afterEach(() => vi.unstubAllGlobals())

  test('календарь месяца в расписании: потянули вниз — закрыт', () => {
    const onClose = vi.fn()
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MonthSheet date="2026-11-11" today="2026-11-11" doctorIds={[]} onPick={() => {}} onClose={onClose} />
      </QueryClientProvider>,
    )
    drag(screen.getByRole('dialog', { name: 'Выбрать день' }), { dy: 300 })
    expect(onClose).toHaveBeenCalled()
  })

  test('Select на телефоне: лист закрывается свайпом вниз, выбор не меняется', async () => {
    phone()
    const onChange = vi.fn()
    render(<Select aria-label="Врач" value="1" onChange={onChange}><option value="1">Асанов</option><option value="2">Бекова</option></Select>)
    await userEvent.click(screen.getByRole('combobox'))
    const sheet = screen.getByRole('listbox').closest('.ui-select-pop')!
    expect(sheet).toHaveClass('sheet')
    drag(sheet, { dy: 300 })
    // Без «Уменьшения движения» лист сперва уезжает вниз (180 мс), потом закрывается
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    expect(onChange).not.toHaveBeenCalled()
  })

  test('подтверждение на телефоне: свайп вниз — как «Отмена»', async () => {
    phone()
    const answers: boolean[] = []
    render(<><ConfirmHost /><button type="button" onClick={() => void ask('Удалить запись?').then((ok) => answers.push(ok))}>Действие</button></>)
    await userEvent.click(screen.getByRole('button', { name: 'Действие' }))
    drag(screen.getByRole('alertdialog'), { dy: 300 })
    await waitFor(() => expect(answers).toEqual([false]))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })
})
