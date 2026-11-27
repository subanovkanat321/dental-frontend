import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import { appointment, me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { PART_KEY } from './callouts'
import LessonDialog from './LessonDialog'
import PosterView from './PosterView'
import { POSTERS, posterForTopic, type Mark } from './posters'
import { SHOTS } from './shots.gen'
import { TOPICS } from './catalog'

afterEach(() => {
  window.history.replaceState(null, '', '/')
  localStorage.clear()
})

const marksOf = (p: (typeof POSTERS)[number]): { shot: keyof typeof SHOTS; marks: Mark[] }[] =>
  p.kind === 'anatomy' ? [{ shot: p.shot, marks: p.legend }] : p.panels.map((x) => ({ shot: x.shot, marks: x.marks }))

test('плакаты: кадры 3D лежат в public/content/learn, у каждой подписи есть точка на кадре; тексты ru и ky, без цен', () => {
  expect(POSTERS.map((p) => p.slug)).toEqual(['tooth', 'caries', 'gums', 'replace', 'wisdom'])
  const dir = resolve(import.meta.dirname, '../../public/content/learn')
  for (const p of POSTERS) {
    const texts = [p.title, p.lead, p.note, ...(p.kind === 'anatomy' ? [p.alt, ...p.legend.map((r) => r.text)] : p.panels.flatMap((x) => [x.title, x.text, x.alt]))]
    for (const t of texts.filter(Boolean)) {
      expect(t!.ru.trim() && t!.ky.trim(), p.slug).toBeTruthy()
      expect(`${t!.ru} ${t!.ky}`).not.toMatch(/\d\s?сом|сомдон/i)
    }
    for (const { shot, marks } of marksOf(p)) {
      for (const f of [`${shot}-640.webp`, `${shot}-1280.webp`]) expect(existsSync(resolve(dir, f)), f).toBe(true)
      const at = SHOTS[shot].at as Record<string, unknown>
      expect(marks.length, shot).toBeGreaterThan(0)
      for (const m of marks) expect(m.at ?? at[PART_KEY[m.part] ?? m.part], `${p.slug}/${shot}: ${m.part}`).toBeDefined()
    }
  }
  // «Если зуба нет» — новые сцены 3D на том же участке челюсти, что «пустое место»
  expect(marksOf(POSTERS[3]!).map((x) => x.shot)).toEqual(['gap-3', 'fix-implant', 'fix-bridge', 'fix-denture'])
  // Плакат есть у тем, где есть что показать на картинке
  expect(TOPICS.filter((t) => posterForTopic(t.slug)).map((t) => t.slug)).toEqual(expect.arrayContaining(['caries', 'canals', 'gums', 'implant', 'extraction']))
})

test('просмотр плакатов: ← → и кнопки, Home/End, цифра или подпись выделяет часть, Esc снимает выделение и закрывает; язык', async () => {
  const onClose = vi.fn()
  render(<PosterView start="tooth" onClose={onClose} />)
  const dialog = screen.getByRole('dialog', { name: 'Плакат: Строение зуба' })
  expect(within(dialog).getByRole('heading', { name: 'Строение зуба' })).toBeInTheDocument()
  // Строение: 7 подписей на картинке с номерами и легенда с пояснениями
  expect(screen.getByRole('button', { name: '1. Эмаль' })).toBeInTheDocument()
  expect(screen.getByText(/Самая твёрдая ткань организма/)).toBeInTheDocument()
  expect(document.querySelectorAll('.pst-callout')).toHaveLength(7)
  expect(screen.getByRole('img', { name: /Здоровый зуб в разрезе/ })).toHaveAttribute('src', '/content/learn/healthy-1280.webp')

  fireEvent.keyDown(window, { key: '3' })
  expect(screen.getByRole('button', { name: '3. Пульпа (нерв)' })).toHaveClass('on')
  expect(screen.getByRole('button', { name: /Пульпа \(нерв\) Мягкая ткань/ })).toHaveAttribute('aria-pressed', 'true')
  await userEvent.click(screen.getByRole('button', { name: '6. Десна' }))
  expect(screen.getByRole('button', { name: '6. Десна' })).toHaveClass('on')
  expect(screen.getByRole('button', { name: '3. Пульпа (нерв)' })).not.toHaveClass('on')
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(onClose).not.toHaveBeenCalled()
  expect(document.querySelector('.pst-callout.on')).toBeNull()

  expect(screen.getByRole('button', { name: 'Предыдущий плакат' })).toBeDisabled()
  fireEvent.keyDown(window, { key: 'ArrowRight' })
  expect(screen.getByRole('heading', { name: 'Кариес: от пятна до воспаления у корня' })).toBeInTheDocument()
  expect(document.querySelectorAll('.pst-panel')).toHaveLength(5)
  expect(screen.getByText('Пульпит', { selector: '.pst-cap-title' })).toBeInTheDocument()
  fireEvent.keyDown(window, { key: '4' })
  expect(document.querySelector('.pst-panel.on')).toHaveTextContent('Пульпит')
  expect(document.querySelectorAll('.pst-panel.dim')).toHaveLength(4)

  await userEvent.click(screen.getByRole('button', { name: 'Следующий плакат' }))
  expect(screen.getByRole('heading', { name: 'Дёсны: гингивит и пародонтит' })).toBeInTheDocument()
  expect(document.querySelector('.pst-panel.on')).toBeNull()
  fireEvent.keyDown(window, { key: 'End' })
  expect(screen.getByRole('heading', { name: 'Зуб мудрости: когда он мешает' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Следующий плакат' })).toBeDisabled()
  fireEvent.keyDown(window, { key: 'ArrowLeft' })
  expect(screen.getByRole('heading', { name: 'Если зуба нет: чем заменить' })).toBeInTheDocument()
  expect(screen.getByText('Съёмный протез')).toBeInTheDocument()
  expect(screen.getByText('Кламмер (крючок)')).toBeInTheDocument()

  await userEvent.click(screen.getByRole('button', { name: 'KG' }))
  expect(screen.getByRole('heading', { name: 'Тиш жок болсо: эмне менен алмаштыруу' })).toBeInTheDocument()
  expect(screen.getByText('Кламмер (илмек)')).toBeInTheDocument()
  expect(screen.getByText('Бул жалпы маалымат. Сиздин дарылоо планыңыз — дарыгериңизде.')).toBeInTheDocument()
  fireEvent.keyDown(window, { key: 'Home' })
  expect(screen.getByRole('heading', { name: 'Тиштин түзүлүшү' })).toBeInTheDocument()

  fireEvent.keyDown(window, { key: 'Escape' })
  expect(onClose).toHaveBeenCalled()
})

test('из презентации — «Плакат» в шапке: плакат по теме поверх слайдов, клавиши листают плакат; закрыли — тот же слайд', async () => {
  const onClose = vi.fn()
  render(<QueryClientProvider client={new QueryClient()}><LessonDialog topic="gums" onClose={onClose} /></QueryClientProvider>)
  fireEvent.keyDown(window, { key: 'ArrowRight' })
  expect(screen.getByText('2 / 5')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Плакат' }))
  expect(await screen.findByRole('dialog', { name: 'Плакат: Дёсны: гингивит и пародонтит' })).toBeInTheDocument()
  fireEvent.keyDown(window, { key: 'ArrowRight' })
  expect(screen.getByRole('dialog', { name: 'Плакат: Если зуба нет: чем заменить' })).toBeInTheDocument()
  expect(screen.getByText('2 / 5')).toBeInTheDocument()
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(screen.queryByRole('dialog', { name: /^Плакат/ })).toBeNull()
  expect(onClose).not.toHaveBeenCalled()
  expect(screen.getByText('2 / 5')).toBeInTheDocument()
})

test('раздел «Для пациента»: «Плакаты» обложками — открыть во весь экран и закрыть', async () => {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', () => HttpResponse.json([appointment(34, 1, '12:00', 'Тест')])),
  )
  renderApp()
  const nav = await screen.findByRole('navigation', { name: 'Разделы' })
  await userEvent.click(within(nav).getByRole('button', { name: 'Для пациента' }))
  expect(await screen.findByRole('heading', { name: 'Плакаты' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: /Строение зуба/ }))
  const dialog = await screen.findByRole('dialog', { name: 'Плакат: Строение зуба' })
  await userEvent.click(within(dialog).getByRole('button', { name: 'Закрыть' }))
  expect(screen.queryByRole('dialog', { name: /^Плакат/ })).toBeNull()
})
