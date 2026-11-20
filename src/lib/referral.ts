/** Код ссылки-приглашения из адреса (?ref=…): латиница и цифры, иначе — нет. */
export function refFromUrl(search = window.location.search): string | null {
  const ref = new URLSearchParams(search).get('ref')?.trim().toLowerCase() ?? ''
  return /^[a-z2-9]{6,12}$/.test(ref) ? ref : null
}

/**
 * Метка канала регистрации из адреса: ?from=instagram (ссылка tish.kg/ig) или ?utm_source=… — латиница и цифры, до 16
 * знаков. Какие метки бывают, решает сервер (BookingChannel): незнакомую он просто не учтёт.
 */
export function signupFromUrl(search = window.location.search): string | null {
  const q = new URLSearchParams(search)
  const from = (q.get('from') ?? q.get('utm_source') ?? '').trim().toLowerCase()
  return /^[a-z0-9]{1,16}$/.test(from) ? from : null
}
