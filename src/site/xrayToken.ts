/** Секрет из /x#<секрет> (43 знака base64url); не похоже — null, без запроса. */
export function xrayToken(hash = window.location.hash): string | null {
  const token = hash.replace(/^#/, '')
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null
}
