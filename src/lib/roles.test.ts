import { expect, test } from 'vitest'

import { me } from '../test/fixtures'
import { seesAllMoney } from './roles'

test('деньги всех врачей: админ — пока не «независимо»; владелец (платформа, админ без приёма) — всегда', () => {
  const independent = { ...me.clinic, independentDoctors: true }
  expect(seesAllMoney({ ...me, admin: true, doctorId: 1 })).toBe(true)
  // «Врачи работают независимо»: админ со своим приёмом видит только своё
  expect(seesAllMoney({ ...me, admin: true, doctorId: 1, platform: false, clinic: independent })).toBe(false)
  // …а хозяин кабинета без своего приёма и владелец платформы — всё
  expect(seesAllMoney({ ...me, admin: true, doctorId: undefined, platform: false, clinic: independent })).toBe(true)
  expect(seesAllMoney({ ...me, admin: false, doctorId: 1, platform: true, clinic: independent })).toBe(true)
  expect(seesAllMoney({ ...me, admin: false, doctorId: 1, platform: false })).toBe(false)
})
