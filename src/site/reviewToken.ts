/** Секрет из адреса /r/<секрет> (43 знака base64url); не похоже — null, без запроса. */
export function reviewToken(path = window.location.pathname): string | null {
  return path.match(/^\/r\/([A-Za-z0-9_-]{43})\/?$/)?.[1] ?? null
}
