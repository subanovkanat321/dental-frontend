import { isStaleChunk, reloadForStaleChunk } from './staleChunk'

/** Кусок кода старой версии пропал (атлас, разделы) — одна перезагрузка; не то или без сети — нет. */
afterEach(() => {
  vi.unstubAllGlobals()
  sessionStorage.clear()
})

test('старый кусок кода — перезагрузка один раз; другая ошибка — нет', () => {
  const reload = vi.fn()
  vi.stubGlobal('location', { ...window.location, reload })
  const stale = new TypeError('Failed to fetch dynamically imported module: /assets/engine-old.js')
  expect(isStaleChunk(stale)).toBe(true)
  expect(reloadForStaleChunk(new Error('WebGL сломался'))).toBe(false)
  expect(reloadForStaleChunk(stale)).toBe(true)
  expect(reloadForStaleChunk(stale)).toBe(false)
  expect(reload).toHaveBeenCalledTimes(1)
})

test('нет сети — это не новая версия: без перезагрузки', () => {
  const reload = vi.fn()
  vi.stubGlobal('location', { ...window.location, reload })
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  expect(reloadForStaleChunk(new TypeError('Importing a module script failed.'))).toBe(false)
  expect(reload).not.toHaveBeenCalled()
  vi.restoreAllMocks()
})
