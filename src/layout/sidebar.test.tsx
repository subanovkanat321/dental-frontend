import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

afterEach(() => localStorage.clear())

test('меню слева сворачивается до иконок и разворачивается; выбор запоминается', async () => {
  server.use(http.get('*/api/patient/me', () => HttpResponse.json(me)))
  const { container, unmount } = renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Свернуть меню' }))
  expect(container.querySelector('.shell')).toHaveClass('narrow')
  // Подсказка у раздела — когда подписи спрятаны
  const nav = screen.getByRole('navigation', { name: 'Разделы' })
  expect(within(nav).getByRole('button', { name: /Пациенты/ })).toHaveAttribute('title', 'Пациенты')
  expect(localStorage.getItem('tish.full.sidebar-narrow')).toBe('1')
  unmount()

  // Открыли заново — меню так и свёрнуто; «Развернуть меню» — обратно
  const again = renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Развернуть меню' }))
  expect(again.container.querySelector('.shell')).not.toHaveClass('narrow')
})
