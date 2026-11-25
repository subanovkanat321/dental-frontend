import { afterEach, describe, expect, it } from 'vitest'

import { applyUi, isUiV2, UI_KEY, uiVersion } from './uiVersion'

describe('UI v2 — переключатель черновика оформления', () => {
  afterEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('ui-v2')
  })

  it('по умолчанию выключено', () => {
    expect(uiVersion('')).toBe('v1')
    applyUi('')
    expect(isUiV2()).toBe(false)
  })

  it('?ui=v2 включает и запоминает на этом устройстве, ?ui=v1 — выключает', () => {
    applyUi('?ui=v2')
    expect(isUiV2()).toBe(true)
    expect(localStorage.getItem(UI_KEY)).toBe('v2')
    expect(uiVersion('')).toBe('v2')
    applyUi('?ui=v1')
    expect(isUiV2()).toBe(false)
    expect(localStorage.getItem(UI_KEY)).toBeNull()
  })

  it('чужие значения параметра не трогают выбор', () => {
    localStorage.setItem(UI_KEY, 'v2')
    expect(uiVersion('?ui=v3')).toBe('v2')
  })
})
