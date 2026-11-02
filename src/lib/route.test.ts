import { expect, test } from 'vitest'

import { isDownloadPath, isLoginPath } from './route'

test('вход — «/login» в любом виде, как набирают; остальное — нет', () => {
  for (const p of ['/login', '/login/', '/Login', '/LOGIN/', '/%D0%B2%D1%85%D0%BE%D0%B4', '/crm', '/admin/']) expect(isLoginPath(p)).toBe(true)
  for (const p of ['/', '/clinics', '/loginx', '/c/abc']) expect(isLoginPath(p)).toBe(false)
})

test('«Скачать Tish» — /app, /download, /скачать; остальное — нет', () => {
  for (const p of ['/app', '/app/', '/APP', '/download', '/%D1%81%D0%BA%D0%B0%D1%87%D0%B0%D1%82%D1%8C']) expect(isDownloadPath(p)).toBe(true)
  for (const p of ['/', '/apps', '/app/x', '/login']) expect(isDownloadPath(p)).toBe(false)
})
