import { depositLines, reminderText, repeatReminderText } from './texts'

/** Предоплата в WhatsApp-напоминании о приёме — как строка бота (Deposits.reminderLine) плюс ссылка на страницу QR. */
describe('предоплата в напоминании за день (WhatsApp)', () => {
  const now = new Date('2026-11-03T06:00:00Z') // 12:00 по Бишкеку
  const a = {
    startAt: '2026-11-04T04:00:00Z', serviceName: 'Чистка', patient: { fullName: 'Айгуль Тестова', telegram: true },
    depositSom: 1500, depositStatus: 'AWAITING',
  }
  const settings = {
    clinicSignature: 'Стоматология «Тест»', clinicName: 'Стоматология «Тест»', clinicAddress: 'Бишкек, ул. Тестовая 1',
    paymentDetails: 'MBank 0555 000 111\nО!Деньги 0700 000 222:', depositPayUrl: 'https://tish.kg/pay/abc',
  }

  test('ждут предоплату — сумма, реквизиты и ссылка на QR перед подписью', () => {
    expect(reminderText(a, settings, null, now)).toBe('Здравствуйте, Айгуль Тестова! 👋 Напоминаем: завтра в 10:00 приём у стоматолога 🦷 '
      + 'Ответьте 1 — приду, 2 — перенести.\n📍 Адрес: Бишкек, ул. Тестовая 1'
      + '\n💳 Не забудьте предоплату 1 500 сом: MBank 0555 000 111, О!Деньги 0700 000 222'
      + '\nQR для оплаты: https://tish.kg/pay/abc\nСтоматология «Тест»')
  })

  test('без QR — без ссылки; без реквизитов — только сумма', () => {
    expect(depositLines(a, { ...settings, depositPayUrl: undefined })).toEqual(['💳 Не забудьте предоплату 1 500 сом: MBank 0555 000 111, О!Деньги 0700 000 222'])
    expect(depositLines(a, { paymentDetails: undefined })).toEqual(['💳 Не забудьте предоплату 1 500 сом.'])
  })

  test('получена, «Я оплатил(а)» уже нажали или не просили — ничего', () => {
    for (const status of ['RECEIVED', 'REPORTED', undefined]) {
      const text = reminderText({ ...a, depositStatus: status }, settings, null, now)
      expect(text).not.toContain('💳')
      expect(text).not.toContain('/pay/')
    }
    expect(reminderText({ ...a, depositSom: undefined, depositStatus: undefined }, { ...settings, clinicAddress: undefined }, null, now))
      .toContain('перенести. Стоматология «Тест»')
  })

  test('свой текст клиники не трогаем — предоплата отдельной строкой после него', () => {
    expect(reminderText(a, { ...settings, reminderTemplate: 'Ждём {когда}, {клиника}', clinicAddress: undefined }, null, now))
      .toBe('Ждём завтра в 10:00, Стоматология «Тест»\nОтветьте 1 — приду, 2 — перенести.'
        + '\n💳 Не забудьте предоплату 1 500 сом: MBank 0555 000 111, О!Деньги 0700 000 222\nQR для оплаты: https://tish.kg/pay/abc')
  })

  test('повтор и кыргызский', () => {
    expect(repeatReminderText(a, settings, null, now)).toContain('перенести.\n💳 Не забудьте предоплату 1 500 сом: MBank')
    expect(repeatReminderText(a, settings, null, now, 'ky'))
      .toContain('келем, 2 — жылдыруу керек.\n💳 1 500 сом алдын ала төлөмдү унутпаңыз: MBank 0555 000 111, О!Деньги 0700 000 222\nТөлөм үчүн QR: https://tish.kg/pay/abc')
  })
})
