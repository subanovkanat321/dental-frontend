/** Код ссылки-приглашения из адреса (?ref=…): латиница и цифры, иначе — нет. */
export function refFromUrl(search = window.location.search): string | null {
  const ref = new URLSearchParams(search).get('ref')?.trim().toLowerCase() ?? ''
  return /^[a-z2-9]{6,12}$/.test(ref) ? ref : null
}
