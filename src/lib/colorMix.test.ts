import { colorMixFallback } from '../../vite.config'

test('запасной цвет для Chrome < 111: первый цвет, а смесь с прозрачным — прозрачный', () => {
  expect(colorMixFallback('color-mix(in srgb, var(--ok-bg) 45%, var(--card))')).toBe('var(--ok-bg)')
  expect(colorMixFallback('color-mix(in srgb, var(--page) 70%, transparent)')).toBe('transparent')
  expect(colorMixFallback('1px dashed color-mix(in srgb, var(--accent) 40%, var(--separator))')).toBe('1px dashed var(--accent)')
  expect(colorMixFallback('color-mix(in srgb, var(--bad-ink, #b42318) 40%, var(--separator))')).toBe('var(--bad-ink, #b42318)')
  expect(colorMixFallback('0 0 0 3px var(--accent), 0 0 0 7px color-mix(in srgb, var(--accent) 35%, transparent)'))
    .toBe('0 0 0 3px var(--accent), 0 0 0 7px transparent')
  expect(colorMixFallback('var(--card)')).toBeNull()
})
