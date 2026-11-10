import { whatsappUrl, withoutEmoji } from './texts'

const text = 'Здравствуйте, Улыбка-Тест! 😊 Мы разработали Tish.\nПосмотрите ролик 👇 Подробнее: https://tish.kg/about\nНеинтересно — ответьте 🙏'

test('Windows: частые эмодзи — на похожие из основной таблицы (они доходят), прочие убраны', () => {
  expect(withoutEmoji(text)).toBe('Здравствуйте, Улыбка-Тест! ☺️ Мы разработали Tish.\nПосмотрите ролик ⬇️ Подробнее: https://tish.kg/about\nНеинтересно — ответьте ✌️')
  expect(withoutEmoji('Ок ❤️ 👨‍👩‍👧 1️⃣ 🦷 да')).toBe('Ок ❤️ 1️⃣ да')
  const url = whatsappUrl('996555000111', text, true)
  expect(decodeURIComponent(url.split('text=')[1]!)).not.toMatch(/[\u{10000}-\u{10FFFF}]/u)
})

test('телефон и Mac: эмодзи остаются', () => {
  expect(decodeURIComponent(whatsappUrl('996555000111', text, false).split('text=')[1]!)).toBe(text)
})
