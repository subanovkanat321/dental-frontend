import { appointment } from '../test/fixtures'
import { mainActionKind } from './mainAction'
import { confirmRemind, isRepeat } from './remindAgain'
import { statusOf } from './status'

/**
 * Бот сам написал «⏰ Ждём вас сегодня в …» за 2 часа (soonRemindedAt), а обычного напоминания не было (запись в тот же
 * день): в расписании — «Бот напомнил», не «Не напомнили»; «Напомнить» главной не предлагаем; повтор — с вопросом.
 * Вымышленный пациент.
 */
const at = new Date(Date.now() - 30 * 60_000).toISOString()

test('«⏰ Ждём вас» ушло ботом — статус «Бот напомнил», главной «Напомнить» нет, повтор спрашивает', async () => {
  const plain = appointment(1, 1, '23:30', 'Бакыт Т.')
  expect(statusOf(plain).label).toBe('Не напомнили')

  const soon = appointment(1, 1, '23:30', 'Бакыт Т.', { soonRemindedAt: at })
  expect(statusOf(soon)).toMatchObject({ label: 'Бот напомнил', tone: 'ok' })
  const ctx = { step: null, payPending: false, debt: false, canBook: true, canRemind: true, waitsDoctor: false }
  expect(mainActionKind(plain, ctx)).toBe('remind')
  expect(mainActionKind(soon, ctx)).toBeNull()
  expect(isRepeat(soon)).toBe(true)
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  await expect(confirmRemind(soon)).resolves.toBe(false)
  expect(confirm.mock.calls[0]![0]).toMatch(/^Уже напоминали (вчера )?в \d\d:\d\d\. Отправить ещё раз\?$/)
  confirm.mockRestore()

  // Обычное напоминание было — по-прежнему «Ждём ответа»
  expect(statusOf(appointment(1, 1, '23:30', 'Бакыт Т.', { soonRemindedAt: at, reminderOpenedAt: at })).label).toBe('Ждём ответа')
})
