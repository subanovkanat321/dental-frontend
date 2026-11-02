import { expect, test } from 'vitest'

import { isLoginPath } from './route'

test('вход — «/login» в любом виде, как набирают; остальное — нет', () => {
  for (const p of ['/login', '/login/', '/Login', '/LOGIN/', '/%D0%B2%D1%85%D0%BE%D0%B4', '/crm', '/admin/']) expect(isLoginPath(p)).toBe(true)
  for (const p of ['/', '/clinics', '/loginx', '/c/abc']) expect(isLoginPath(p)).toBe(false)
})
