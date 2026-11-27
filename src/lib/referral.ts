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

/** Код личной ссылки из сообщения клинике (/start?k=…, V272): base64url, 16–32 знака, иначе — нет. */
export function inviteFromUrl(search = window.location.search): string | null {
  const k = new URLSearchParams(search).get('k')?.trim() ?? ''
  return /^[A-Za-z0-9_-]{16,32}$/.test(k) ? k : null
}

/**
 * Убрать код личной ссылки из адреса (остальные метки — ref, from — остаются): адрес с кодом не остаётся в истории
 * браузера, не уходит в Referer и в скриншоты. Только history.replaceState — без перезагрузки и без новой записи.
 */
export function dropInviteFromUrl(): void {
  const q = new URLSearchParams(window.location.search)
  if (!q.has('k')) return
  q.delete('k')
  const rest = q.toString()
  window.history.replaceState(window.history.state, '', window.location.pathname + (rest ? `?${rest}` : '') + window.location.hash)
}
