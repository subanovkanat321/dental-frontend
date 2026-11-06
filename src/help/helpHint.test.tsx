import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { CHAPTERS } from '../site/guide/content'
import { HelpHint } from './HelpHint'
import { HINTS } from './hints'

test('«?» закрыта, пока не нажали; текст и ссылка на раздел руководства; Esc и нажатие мимо закрывают', async () => {
  const user = userEvent.setup()
  render(<><h1>Касса</h1><HelpHint hint="cash" /><p>мимо</p></>)
  const button = screen.getByRole('button', { name: 'Подсказка: Касса' })
  expect(button).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByRole('note')).not.toBeInTheDocument()

  await user.click(button)
  const note = screen.getByRole('note', { name: 'Подсказка: Касса' })
  expect(note).toHaveTextContent(/Выручка за период/)
  expect(screen.getByRole('link', { name: 'Подробнее в руководстве' })).toHaveAttribute('href', '/guide?from=app#kassa')
  expect(button).toHaveAttribute('aria-expanded', 'true')

  await user.keyboard('{Escape}')
  expect(screen.queryByRole('note')).not.toBeInTheDocument()

  await user.click(button)
  await user.click(screen.getByText('мимо'))
  expect(screen.queryByRole('note')).not.toBeInTheDocument()
})

test('каждая подсказка ведёт на существующую главу или раздел руководства, текст — коротко', () => {
  const anchors = new Set(CHAPTERS.flatMap((c) => [c.id, ...c.sections.map((s) => s.id).filter(Boolean)]))
  for (const [key, h] of Object.entries(HINTS)) {
    expect(anchors, key).toContain(h.anchor)
    expect(h.text.length, key).toBeLessThanOrEqual(200)
  }
})
