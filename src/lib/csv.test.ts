import { csvText, toCsv } from './csv'

test('CSV: текст, похожий на формулу, — с апострофом; числа и обычный текст — как есть', () => {
  expect(csvText('=HYPERLINK("http://x")')).toBe(`'=HYPERLINK("http://x")`)
  expect(csvText('@SUM(A1)')).toBe(`'@SUM(A1)`)
  expect(csvText('+996 555 12 34 56')).toBe(`'+996 555 12 34 56`)
  expect(csvText('-1500')).toBe('-1500')
  expect(csvText('Улыбка =1')).toBe('Улыбка =1')
  expect(toCsv([['=1+1', -500, 'a;b']])).toBe(`\uFEFF'=1+1;-500;"a;b"`)
})
