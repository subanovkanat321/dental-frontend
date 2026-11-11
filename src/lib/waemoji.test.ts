import { whatsappUrl, withoutEmoji } from './texts'

const text = 'Здравствуйте, Улыбка-Тест! 😊 Мы разработали Tish.\nПосмотрите ролик 👇 Подробнее: https://tish.kg/about\nНеинтересно — ответьте 🙏'

test('Windows: эмодзи убраны совсем (из ссылки они приходят «�»), пробелы не двоятся', () => {
  expect(withoutEmoji(text)).toBe('Здравствуйте, Улыбка-Тест! Мы разработали Tish.\nПосмотрите ролик Подробнее: https://tish.kg/about\nНеинтересно — ответьте')
  expect(withoutEmoji('Ок ❤️ 👨‍👩‍👧 ☺️ 🦷 да')).toBe('Ок да')
  const url = whatsappUrl('996555000111', text, true)
  expect(decodeURIComponent(url.split('text=')[1]!)).not.toMatch(/[\u{10000}-\u{10FFFF}]/u)
})

test('телефон и Mac: эмодзи остаются', () => {
  expect(decodeURIComponent(whatsappUrl('996555000111', text, false).split('text=')[1]!)).toBe(text)
})

test('«+» доходит: на компьютере ссылка сразу на api.whatsapp.com (wa.me при переадресации делает из «+» пробел)', () => {
  const plus = 'Если интересно — просто ответьте «+»'
  const desktop = whatsappUrl('996555000111', plus, false, false)
  expect(desktop).toMatch(/^https:\/\/api\.whatsapp\.com\/send\/\?phone=996555000111&text=/)
  expect(desktop).toContain('%2B')
  expect(decodeURIComponent(desktop.split('text=')[1]!)).toBe(plus)
  expect(whatsappUrl('', plus, false, false)).toMatch(/^https:\/\/api\.whatsapp\.com\/send\/\?text=/)
  expect(whatsappUrl('996555000111', plus, false, true)).toBe(`https://wa.me/996555000111?text=${encodeURIComponent(plus)}`)
})
