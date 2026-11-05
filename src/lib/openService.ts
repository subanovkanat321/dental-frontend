const KEY = 'crm.openService'

/**
 * Открыть карточку услуги в «Настройки → Услуги и цены» после перехода туда (из карточки приёма:
 * «Настроить материалы услуги»). Номер услуги — не личные данные; sessionStorage — на эту вкладку.
 */
export function openServiceLater(id: number) {
  try {
    sessionStorage.setItem(KEY, String(id))
  } catch {
    // нет хранилища — откроется просто список услуг
  }
}

/** Номер услуги, которую просили открыть (не стирает — это делает clearServiceToOpen). */
export function serviceToOpen(): number | null {
  try {
    const v = sessionStorage.getItem(KEY)
    return v && /^\d+$/.test(v) ? Number(v) : null
  } catch {
    return null
  }
}

/** Открыли — забыть, чтобы при следующем входе в «Услуги» открылся список. */
export function clearServiceToOpen() {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    // нет хранилища — нечего стирать
  }
}
