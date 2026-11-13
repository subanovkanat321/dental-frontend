import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

afterEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
})

/** Ширина окна компьютера: matchMedia по min/max-width. */
function width(px: number) {
  vi.stubGlobal('matchMedia', (query: string) => {
    const min = /min-width: (\d+)px/.exec(query)
    const max = /max-width: (\d+)px/.exec(query)
    return { matches: (!min || px >= Number(min[1])) && (!max || px <= Number(max[1])), addEventListener() {}, removeEventListener() {} }
  })
}

test('меню слева сворачивается кнопкой у логотипа и разворачивается; выбор запоминается', async () => {
  server.use(http.get('*/api/patient/me', () => HttpResponse.json(me)))
  const { container, unmount } = renderApp()
  const toggle = await screen.findByRole('button', { name: 'Свернуть меню' })
  // Кнопка — в верхней строке меню, рядом с логотипом (а не внизу под «Помощью»)
  expect(toggle.closest('.brand-row')).toContainElement(screen.getByRole('button', { name: 'На главную — расписание' }))
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await userEvent.click(toggle)
  expect(container.querySelector('.shell')).toHaveClass('narrow')
  // Подписи спрятаны: имя раздела — у кнопки для читалки и подсказкой при наведении
  const nav = screen.getByRole('navigation', { name: 'Разделы' })
  const learn = within(nav).getByRole('button', { name: 'Для пациента' })
  await userEvent.hover(learn)
  expect(screen.getByRole('tooltip')).toHaveTextContent('Для пациента')
  await userEvent.unhover(learn)
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  expect(localStorage.getItem('tish.full.sidebar-narrow')).toBe('1')
  unmount()

  // Открыли заново — меню так и свёрнуто; та же кнопка «Развернуть меню» — обратно
  const again = renderApp()
  const expand = await screen.findByRole('button', { name: 'Развернуть меню' })
  expect(expand).toHaveAttribute('aria-expanded', 'false')
  await userEvent.click(expand)
  expect(again.container.querySelector('.shell')).not.toHaveClass('narrow')
})

test('клавиша «[» сворачивает и разворачивает меню, но не при вводе в поле и не с Ctrl', async () => {
  server.use(http.get('*/api/patient/me', () => HttpResponse.json(me)))
  window.location.hash = '/patients'
  const { container } = renderApp()
  const shell = () => container.querySelector('.shell')
  const search = await screen.findByRole('searchbox')
  await userEvent.type(search, '[[')
  expect(search).toHaveValue('[')
  expect(shell()).not.toHaveClass('narrow')

  fireEvent.keyDown(document.body, { key: '[', ctrlKey: true })
  expect(shell()).not.toHaveClass('narrow')
  fireEvent.keyDown(document.body, { key: '[' })
  expect(shell()).toHaveClass('narrow')
  fireEvent.keyDown(document.body, { key: '[' })
  expect(shell()).not.toHaveClass('narrow')
  window.location.hash = ''
})

test('ноутбук 1366px: пока не выбирали — меню свёрнуто; выбрали развёрнутое — так и остаётся', async () => {
  width(1366)
  server.use(http.get('*/api/patient/me', () => HttpResponse.json(me)))
  const first = renderApp()
  await screen.findByRole('button', { name: 'Развернуть меню' })
  expect(first.container.querySelector('.shell')).toHaveClass('narrow')
  await userEvent.click(screen.getByRole('button', { name: 'Развернуть меню' }))
  first.unmount()

  renderApp()
  expect(await screen.findByRole('button', { name: 'Свернуть меню' })).toBeInTheDocument()
})

test('большой экран 1920px: по умолчанию меню развёрнуто', async () => {
  width(1920)
  server.use(http.get('*/api/patient/me', () => HttpResponse.json(me)))
  const { container } = renderApp()
  await screen.findByRole('button', { name: 'Свернуть меню' })
  expect(container.querySelector('.shell')).not.toHaveClass('narrow')
})
