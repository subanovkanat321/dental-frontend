import { cityName, guessCity, matchesQuery, withCity } from './clinicSearch'

test('город из адреса — словом, без ложных совпадений внутри слов', () => {
  expect(guessCity('г. Бишкек, ул. Киевская 95')).toBe('Бишкек')
  expect(guessCity('Ош, ул. Ленина 1')).toBe('Ош')
  expect(guessCity('ул. Кошоева 5, Ошский рынок')).toBeNull()
  expect(guessCity('г.Жалал-Абад, Токтогула 3')).toBe('Джалал-Абад')
  expect(guessCity('ул. Кантемира 4')).toBeNull()
  expect(guessCity('Кант, Ленина 1')).toBe('Кант')
  expect(guessCity('ул. Шевченко 6')).toBeNull()
})

test('поиск — все слова, без регистра и «ё»; город впереди адреса, если его там нет', () => {
  expect(matchesQuery(['Улыбка', 'Бишкек, Манаса 1'], 'улыбка МАНАСА')).toBe(true)
  expect(matchesQuery(['Дент', null, 'Пётр'], 'петр')).toBe(true)
  expect(matchesQuery(['Дент'], 'улыбка')).toBe(false)
  expect(withCity('ул. Ленина 1', 'Ош')).toBe('Ош, ул. Ленина 1')
  expect(withCity('г. Ош, ул. Ленина 1', 'Ош')).toBe('г. Ош, ул. Ленина 1')
  expect(withCity(null, 'Ош')).toBe('Ош')
  expect(cityName('Джалал-Абад', 'ky')).toBe('Жалал-Абад')
})
