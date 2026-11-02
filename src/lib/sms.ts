/**
 * «Напомнить SMS» — включается на устройстве (телефон сотрудника с SIM-картой): SMS уходит с его
 * номера по его тарифу. В localStorage — только «on», без личных данных.
 */
const KEY = 'crm.sms'

export function smsEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) === 'on'
  } catch {
    return false
  }
}

export function setSmsEnabled(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, 'on')
    else localStorage.removeItem(KEY)
  } catch {
    // приватный режим — без переключателя
  }
}
