import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect, useState } from 'react'

import { backDepth, enableBackHistory, useBack } from './back'
import { openSettings } from './route'
import { useClose } from './useClose'
import { useUnsaved } from './unsaved'

/** Глубина нашей записи истории (0 — не наша). */
const depth = () => (window.history.state as { tishBack?: number } | null)?.tishBack ?? 0

/** «Назад» телефона/браузера: history.back() и дождаться popstate. */
async function pressBack() {
  const before = window.location.href + JSON.stringify(window.history.state)
  await act(async () => {
    window.history.back()
    await vi.waitFor(() => expect(window.location.href + JSON.stringify(window.history.state)).not.toBe(before))
  })
}

function Card({ onClose, dirty = false }: { onClose: () => void; dirty?: boolean }) {
  const close = useClose(onClose)
  useUnsaved(dirty)
  return <aside aria-label="Карточка"><button type="button" onClick={close}>✕</button></aside>
}

function Sheet({ onClose }: { onClose: () => void }) {
  useBack(onClose)
  return <div role="dialog" aria-label="Лист">лист</div>
}

function Page({ dirty }: { dirty?: boolean }) {
  const [card, setCard] = useState(false)
  const [sheet, setSheet] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setCard(true)}>Открыть приём</button>
      {card && <Card dirty={dirty} onClose={() => setCard(false)} />}
      {card && <button type="button" onClick={() => setSheet(true)}>Выбрать врача</button>}
      {card && sheet && <Sheet onClose={() => setSheet(false)} />}
    </>
  )
}

beforeEach(() => {
  enableBackHistory(true)
  window.history.replaceState(null, '', '/#/schedule')
})

afterEach(async () => {
  enableBackHistory(false)
  // отложенные шаги назад этого теста — до следующего
  await new Promise((r) => setTimeout(r, 30))
})

test('карточка кладёт шаг в историю; «Назад» телефона закрывает её, а не уводит со страницы', async () => {
  render(<Page />)
  const start = window.history.length
  await userEvent.click(screen.getByRole('button', { name: 'Открыть приём' }))
  await vi.waitFor(() => expect(depth()).toBe(1))
  expect(window.history.length).toBe(start + 1)

  await pressBack()
  expect(screen.queryByRole('complementary', { name: 'Карточка' })).not.toBeInTheDocument()
  expect(window.location.hash).toBe('#/schedule')
  expect(backDepth()).toBe(0)
})

test('карточка и лист в ней: первый «Назад» закрывает лист, второй — карточку', async () => {
  render(<Page />)
  await userEvent.click(screen.getByRole('button', { name: 'Открыть приём' }))
  await userEvent.click(screen.getByRole('button', { name: 'Выбрать врача' }))
  await vi.waitFor(() => expect(depth()).toBe(2))

  await pressBack()
  expect(screen.queryByRole('dialog', { name: 'Лист' })).not.toBeInTheDocument()
  expect(screen.getByRole('complementary', { name: 'Карточка' })).toBeInTheDocument()

  await pressBack()
  expect(screen.queryByRole('complementary', { name: 'Карточка' })).not.toBeInTheDocument()
  expect(depth()).toBe(0)
})

test('✕ убирает запись карточки из истории: лишнего шага «Назад» не остаётся', async () => {
  render(<Page />)
  await userEvent.click(screen.getByRole('button', { name: 'Открыть приём' }))
  await vi.waitFor(() => expect(depth()).toBe(1))
  const opened = window.history.length

  await userEvent.click(screen.getByRole('button', { name: '✕' }))
  expect(screen.queryByRole('complementary', { name: 'Карточка' })).not.toBeInTheDocument()
  await vi.waitFor(() => expect(depth()).toBe(0))

  // Открыли снова — запись встала на место прежней, история не растёт
  await userEvent.click(screen.getByRole('button', { name: 'Открыть приём' }))
  await vi.waitFor(() => expect(depth()).toBe(1))
  expect(window.history.length).toBe(opened)
})

test('несохранённые правки: «Назад» спрашивает; «не выходить» — карточка и её шаг остаются', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  render(<Page dirty />)
  await userEvent.click(screen.getByRole('button', { name: 'Открыть приём' }))
  await vi.waitFor(() => expect(depth()).toBe(1))

  await act(async () => {
    window.history.back()
    await vi.waitFor(() => expect(confirm).toHaveBeenCalled())
  })
  expect(screen.getByRole('complementary', { name: 'Карточка' })).toBeInTheDocument()
  await vi.waitFor(() => expect(depth()).toBe(1))
  confirm.mockRestore()
})

/** Пункт «Настроек» по адресу (#/settings/…) и лист в нём. */
function Settings() {
  const [item, setItem] = useState(() => window.location.hash)
  const [sheet, setSheet] = useState(false)
  useEffect(() => {
    const on = () => setItem(window.location.hash)
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  if (item === '#/settings') return <button type="button" onClick={() => openSettings('hours')}>Рабочее время</button>
  return (
    <>
      <h1>Пункт</h1>
      <button type="button" onClick={() => setSheet(true)}>Выбрать</button>
      {sheet && <Sheet onClose={() => setSheet(false)} />}
    </>
  )
}

test('подэкран «Настроек» и лист: первый «Назад» закрывает лист, второй — подэкран', async () => {
  window.history.replaceState(null, '', '/#/settings')
  render(<Settings />)
  await userEvent.click(screen.getByRole('button', { name: 'Рабочее время' }))
  expect(await screen.findByRole('heading', { name: 'Пункт' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Выбрать' }))
  await vi.waitFor(() => expect(depth()).toBe(1))

  await pressBack()
  expect(screen.queryByRole('dialog', { name: 'Лист' })).not.toBeInTheDocument()
  expect(window.location.hash).toBe('#/settings/hours')

  await pressBack()
  expect(await screen.findByRole('button', { name: 'Рабочее время' })).toBeInTheDocument()
})

test('«‹ Настройки» в пункте, открытом из списка, — шаг назад, а не новая запись', async () => {
  window.history.replaceState(null, '', '/#/settings')
  render(<Settings />)
  await userEvent.click(screen.getByRole('button', { name: 'Рабочее время' }))
  expect(await screen.findByRole('heading', { name: 'Пункт' })).toBeInTheDocument()
  const opened = window.history.length
  await act(async () => openSettings(null))
  expect(await screen.findByRole('button', { name: 'Рабочее время' })).toBeInTheDocument()
  // Шагнули назад по истории, а не положили новую запись: «Вперёд» снова откроет пункт
  expect(window.history.length).toBe(opened)
  expect(window.location.hash).toBe('#/settings')
})

test('в Telegram история не трогается: «назад» — его стрелка, тот же стек', async () => {
  let click: (() => void) | null = null
  window.Telegram = { WebApp: { initData: 'test', ready() {}, expand() {},
    BackButton: { show() {}, hide() {}, onClick: (cb: () => void) => { click = cb }, offClick() {} } } }
  try {
    render(<Page />)
    const start = window.history.length
    await userEvent.click(screen.getByRole('button', { name: 'Открыть приём' }))
    await userEvent.click(screen.getByRole('button', { name: 'Выбрать врача' }))
    await new Promise((r) => setTimeout(r, 10))
    expect(window.history.length).toBe(start)

    act(() => click?.())
    expect(screen.queryByRole('dialog', { name: 'Лист' })).not.toBeInTheDocument()
    act(() => click?.())
    expect(screen.queryByRole('complementary', { name: 'Карточка' })).not.toBeInTheDocument()
  } finally {
    delete window.Telegram
  }
})
