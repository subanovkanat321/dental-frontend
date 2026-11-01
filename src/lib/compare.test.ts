import { changeOf, previousRange } from './compare'

test('с чем сравнивать: день — с тем же днём недели, месяц — те же числа, период — столько же дней до', () => {
  expect(previousRange('day', { from: '2026-11-03', to: '2026-11-03' })).toMatchObject({ from: '2026-10-27', to: '2026-10-27' })
  expect(previousRange('week', { from: '2026-10-26', to: '2026-10-31' })).toMatchObject({ from: '2026-10-19', to: '2026-10-24' })
  expect(previousRange('month', { from: '2026-11-01', to: '2026-11-10' })).toMatchObject({ from: '2026-10-01', to: '2026-10-10' })
  expect(previousRange('month', { from: '2026-03-01', to: '2026-03-31' })).toMatchObject({ from: '2026-02-01', to: '2026-02-28' })
  expect(previousRange('month', { from: '2026-01-01', to: '2026-01-15' })).toMatchObject({ from: '2025-12-01', to: '2025-12-15' })
  expect(previousRange('custom', { from: '2026-10-11', to: '2026-10-20' })).toMatchObject({ from: '2026-10-01', to: '2026-10-10', label: 'к предыдущим 10 дн.' })
})

test('изменение: рост, падение, как было, из нуля', () => {
  expect(changeOf(11200, 10000)).toEqual({ text: '▲ 12%', tone: 'ok' })
  expect(changeOf(7000, 10000)).toEqual({ text: '▼ 30%', tone: 'bad' })
  expect(changeOf(10000, 10000).text).toBe('как было')
  expect(changeOf(5000, 0).text).toBe('раньше было 0')
})
