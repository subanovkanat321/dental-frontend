import { howToPay, STANDARD_DEBT } from './debt'
import { applyTemplate, DEBT_VARIABLES, unknownVariables, usesVariable } from './reminderTemplate'
import { appointmentPhone, forAppointment, reminderText, soonText, whenAt } from './texts'

/**
 * Те же примеры, что ReminderTemplateTests бэкенда: бот и WhatsApp из CRM собирают текст одинаково.
 * Пациенты вымышленные.
 */
const ALL = {
  имя: 'Айгуль', когда: 'завтра в 10:00', врач: 'Асель Маратовна', услуга: 'Чистка', клиника: 'Стоматология «Тест»',
  адрес: 'Бишкек, ул. Тестовая 1', телефон: '+996 555 000 000', бот: 'https://t.me/test_bot?start=c_test',
}

test('все переменные', () => {
  expect(applyTemplate('{имя}, ждём {когда}. Врач: {врач}, {услуга}. {клиника}, {адрес}, {телефон}. {бот}', ALL))
    .toBe('Айгуль, ждём завтра в 10:00. Врач: Асель Маратовна, Чистка. Стоматология «Тест», Бишкек, ул. Тестовая 1, '
      + '+996 555 000 000. https://t.me/test_bot?start=c_test')
})

test('регистр не важен', () => {
  expect(applyTemplate('{Имя}, {КОГДА}', ALL)).toBe('Айгуль, завтра в 10:00')
})

test('пустое значение убирается аккуратно', () => {
  const values = { ...ALL, услуга: null, бот: '' }
  expect(applyTemplate('Ждём {когда} у стоматолога ({услуга}).', values)).toBe('Ждём завтра в 10:00 у стоматолога.')
  expect(applyTemplate('Врач {врач}, {услуга}, {когда}.', values)).toBe('Врач Асель Маратовна, завтра в 10:00.')
  expect(applyTemplate('Здравствуйте, {имя}!\n{бот}\nДо встречи', values)).toBe('Здравствуйте, Айгуль!\nДо встречи')
  expect(applyTemplate('Ждём вас {услуга} {когда} .', values)).toBe('Ждём вас завтра в 10:00.')
  // Строка-подпись с пустой переменной пропадает целиком; с непустой — остаётся (как ReminderTemplateTests бэкенда)
  expect(applyTemplate('Здравствуйте, {имя}!\nУслуга: {услуга}\nДо встречи', values)).toBe('Здравствуйте, Айгуль!\nДо встречи')
  expect(applyTemplate('Врач: {врач}\nКогда: {когда} {услуга}', values)).toBe('Врач: Асель Маратовна\nКогда: завтра в 10:00')
})

test('неизвестная переменная остаётся как есть', () => {
  expect(applyTemplate('{имя}, {name} и { } {a b}', ALL)).toBe('Айгуль, {name} и { } {a b}')
  expect(unknownVariables('{name} {0} {имя} {name}')).toEqual(['name', '0'])
})

test('есть ли переменная', () => {
  expect(usesVariable('Адрес: {Адрес}', 'адрес')).toBe(true)
  expect(usesVariable('Адрес у нас прежний', 'адрес')).toBe(false)
})

describe('напоминание в WhatsApp/SMS', () => {
  const now = new Date('2026-11-03T06:00:00Z') // 12:00 по Бишкеку
  const tomorrow10 = '2026-11-04T04:00:00Z'
  const a = { startAt: tomorrow10, serviceName: 'Чистка', patient: { fullName: 'Айгуль', telegram: false } }
  const settings = {
    clinicSignature: 'Стоматология «Тест»', botUrl: 'https://t.me/test_bot?start=c_test', clinicName: 'Стоматология «Тест»',
    clinicAddress: 'Бишкек, ул. Тестовая 1', clinicPhone: '+996 555 000 000',
  }

  test('{когда} — как у бота', () => {
    expect(whenAt(tomorrow10, now)).toBe('завтра в 10:00')
    expect(whenAt('2026-11-03T04:00:00Z', now)).toBe('сегодня в 10:00')
    expect(whenAt('2026-11-09T04:00:00Z', now)).toBe('понедельник, 9 ноября, в 10:00')
  })

  test('без своего текста — стандартный, адрес (как в Telegram), подпись и ссылка на бота', () => {
    expect(reminderText(a, settings, 'Асель', now)).toBe('Здравствуйте, Айгуль! 👋 Напоминаем: завтра в 10:00 приём у стоматолога 🦷 '
      + 'Ответьте 1 — приду, 2 — перенести.\n📍 Адрес: Бишкек, ул. Тестовая 1\nСтоматология «Тест»\n\n📲 Записываться самим и получать напоминания можно в Telegram: '
      + 'https://t.me/test_bot?start=c_test')
    // Адреса в «О клинике» нет — как раньше, одной строкой
    expect(reminderText(a, { ...settings, clinicAddress: undefined }, 'Асель', now)).toContain('перенести. Стоматология «Тест»')
  })

  test('свой текст: подстановка, «Ответьте 1…», подпись и ссылка на бота отдельной строкой', () => {
    expect(reminderText(a, { ...settings, reminderTemplate: '{имя}, ждём вас {когда} у врача {врач} ({услуга}).' }, 'Асель Маратовна', now))
      .toBe('Айгуль, ждём вас завтра в 10:00 у врача Асель Маратовна (Чистка).\nОтветьте 1 — приду, 2 — перенести.\n📍 Адрес: Бишкек, ул. Тестовая 1\nСтоматология «Тест»'
        + '\n\n📲 Записываться самим и получать напоминания можно в Telegram: https://t.me/test_bot?start=c_test')
  })

  test('{клиника} и {бот} в тексте — подпись и ссылку не дублируем; пациенту из бота ссылка не нужна', () => {
    const own = { ...settings, reminderTemplate: 'Ждём {когда}. {клиника}\nОтветить в Telegram: {бот}' }
    expect(reminderText(a, own, null, now)).toBe('Ждём завтра в 10:00. Стоматология «Тест»\nОтветить в Telegram: https://t.me/test_bot?start=c_test'
      + '\nОтветьте 1 — приду, 2 — перенести.\n📍 Адрес: Бишкек, ул. Тестовая 1')
    // {адрес} в тексте — отдельной строкой не дублируем
    expect(reminderText(a, { ...settings, reminderTemplate: 'Ждём {когда}, {адрес}' }, null, now)).not.toContain('📍')
    expect(reminderText({ ...a, patient: { fullName: 'Айгуль', telegram: true } }, { ...settings, reminderTemplate: 'Ждём {когда}' }, null, now))
      .toBe('Ждём завтра в 10:00\nОтветьте 1 — приду, 2 — перенести.\n📍 Адрес: Бишкек, ул. Тестовая 1\nСтоматология «Тест»')
  })
})

test('напоминание о долге: стандартный текст, без врача строка «Врач:» пропадает, реквизиты без двойной точки', () => {
  const names = DEBT_VARIABLES.map(([name]) => name)
  const values = { имя: 'Асель Тестова', клиника: 'Тест', сумма: '500 сом', оплата: howToPay(null) }
  expect(applyTemplate(STANDARD_DEBT, values, names)).toBe([
    'Здравствуйте, Асель Тестова!', 'Напоминаем об оплате за лечение в стоматологии «Тест».', 'К оплате: 500 сом.',
    'Оплатить можно в клинике.', 'Если вы уже оплатили — спасибо, просто не обращайте внимания 🙏',
  ].join('\n'))
  expect(applyTemplate(STANDARD_DEBT, { ...values, врач: 'Айгерим Садыкова, Дастан Т.' }, names)).toContain('\nВрач: Айгерим Садыкова, Дастан Т.\n')
  expect(howToPay('MBANK 0555 123 456')).toBe('Оплатить можно в клинике или переводом: MBANK 0555 123 456.')
  expect(howToPay('MBANK 0555 123 456.')).toBe('Оплатить можно в клинике или переводом: MBANK 0555 123 456.')
  expect(howToPay('MBANK 0555 123 456\nО!Деньги 0700 000 111,')).toBe('Оплатить можно в клинике или переводом: MBANK 0555 123 456, О!Деньги 0700 000 111.')
})

test('«Номер в напоминаниях»: клиники по умолчанию; врача — если указал, иначе клиники; «Ждём вас» — тот же номер', () => {
  const clinic = { clinicPhone: '+996 555 000 000', doctorPhones: { 1: '+996 700 123 456' } }
  expect(appointmentPhone({ ...clinic, reminderContact: 'CLINIC' }, 1)).toEqual({ phone: '+996 555 000 000', doctor: false })
  expect(appointmentPhone({ ...clinic, reminderContact: 'DOCTOR' }, 1)).toEqual({ phone: '+996 700 123 456', doctor: true })
  expect(appointmentPhone({ ...clinic, reminderContact: 'DOCTOR' }, 2)).toEqual({ phone: '+996 555 000 000', doctor: false })
  expect(appointmentPhone({ reminderContact: 'DOCTOR' }, 2)).toEqual({ phone: null, doctor: false })
  expect(soonText('2026-10-23T06:00:00Z', forAppointment({ ...clinic, reminderContact: 'DOCTOR' }, 1), new Date('2026-10-23T03:00:00Z')))
    .toContain('позвоните, пожалуйста: +996 700 123 456')
  const a = { startAt: '2026-10-24T04:00:00Z', patient: { fullName: 'Айгуль', telegram: true } }
  expect(reminderText(a, forAppointment({ ...clinic, reminderContact: 'DOCTOR', reminderTemplate: 'Ждём {когда}. {телефон}' }, 1), null,
    new Date('2026-10-23T03:00:00Z'))).toContain('Ждём завтра в 10:00. +996 700 123 456')
})
