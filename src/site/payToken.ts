/** Токен QR из адреса /pay/<токен> (43 знака base64url); не похоже — null, без запроса. */
export function payToken(path = window.location.pathname): string | null {
  return path.match(/^\/pay\/([A-Za-z0-9_-]{43})\/?$/)?.[1] ?? null
}
