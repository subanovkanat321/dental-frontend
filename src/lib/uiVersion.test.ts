import { afterEach, describe, expect, it } from 'vitest'

import { applyUi, isUiV2, UI_KEY, uiVersion } from './uiVersion'

describe('UI v2 — новое оформление по умолчанию, ?ui=v1 — старый вид', () => {
  afterEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('ui-v2')
  })

  it('по умолчанию — новое оформление, ничего не запоминая', () => {
    expect(uiVersion('')).toBe('v2')
    applyUi('')
    expect(isUiV2()).toBe(true)
    expect(localStorage.getItem(UI_KEY)).toBeNull()
  })

  it('?ui=v1 возвращает старый вид и запоминает на этом устройстве, ?ui=v2 — забывает выбор', () => {
    applyUi('?ui=v1')
    expect(isUiV2()).toBe(false)
    expect(localStorage.getItem(UI_KEY)).toBe('v1')
    expect(uiVersion('')).toBe('v1')
    applyUi('?ui=v2')
    expect(isUiV2()).toBe(true)
    expect(localStorage.getItem(UI_KEY)).toBeNull()
    expect(uiVersion('')).toBe('v2')
  })

  it('флаг превью «v2» (до перехода) стирается — дальше просто по умолчанию', () => {
    localStorage.setItem(UI_KEY, 'v2')
    expect(uiVersion('')).toBe('v2')
    expect(localStorage.getItem(UI_KEY)).toBeNull()
  })

  it('чужие значения параметра не трогают выбор', () => {
    localStorage.setItem(UI_KEY, 'v1')
    expect(uiVersion('?ui=v3')).toBe('v1')
  })

  it('без localStorage (приватный режим) — по адресу, иначе новое', () => {
    const real = Object.getOwnPropertyDescriptor(window, 'localStorage')!
    Object.defineProperty(window, 'localStorage', { configurable: true, get: () => { throw new Error('denied') } })
    try {
      expect(uiVersion('')).toBe('v2')
      expect(uiVersion('?ui=v1')).toBe('v1')
    } finally {
      Object.defineProperty(window, 'localStorage', real)
    }
  })
})
