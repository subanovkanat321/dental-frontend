import { applyTemplate, unknownVariables, usesVariable } from './reminderTemplate'
import { reminderText, whenAt } from './texts'

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

  test('без своего текста — стандартный, подпись и ссылка на бота', () => {
    expect(reminderText(a, settings, 'Асель', now)).toBe('Здравствуйте, Айгуль! 👋 Напоминаем: завтра в 10:00 приём у стоматолога 🦷 '
      + 'Ответьте 1 — приду, 2 — перенести. Стоматология «Тест»\n\n📲 Записываться самим и получать напоминания можно в Telegram: '
      + 'https://t.me/test_bot?start=c_test')
  })

  test('свой текст: подстановка, «Ответьте 1…», подпись и ссылка на бота отдельной строкой', () => {
    expect(reminderText(a, { ...settings, reminderTemplate: '{имя}, ждём вас {когда} у врача {врач} ({услуга}).' }, 'Асель Маратовна', now))
      .toBe('Айгуль, ждём вас завтра в 10:00 у врача Асель Маратовна (Чистка).\nОтветьте 1 — приду, 2 — перенести.\nСтоматология «Тест»'
        + '\n\n📲 Записываться самим и получать напоминания можно в Telegram: https://t.me/test_bot?start=c_test')
  })

  test('{клиника} и {бот} в тексте — подпись и ссылку не дублируем; пациенту из бота ссылка не нужна', () => {
    const own = { ...settings, reminderTemplate: 'Ждём {когда}. {клиника}\nОтветить в Telegram: {бот}' }
    expect(reminderText(a, own, null, now)).toBe('Ждём завтра в 10:00. Стоматология «Тест»\nОтветить в Telegram: https://t.me/test_bot?start=c_test'
      + '\nОтветьте 1 — приду, 2 — перенести.')
    expect(reminderText({ ...a, patient: { fullName: 'Айгуль', telegram: true } }, { ...settings, reminderTemplate: 'Ждём {когда}' }, null, now))
      .toBe('Ждём завтра в 10:00\nОтветьте 1 — приду, 2 — перенести.\nСтоматология «Тест»')
  })
})
