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
