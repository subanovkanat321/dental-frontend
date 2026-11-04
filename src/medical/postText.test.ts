import { chatGptUrl } from './postText'

test('«Улучшить в ChatGPT»: ссылка на chatgpt.com с просьбой и текстом поста', () => {
  const url = new URL(chatGptUrl('Отбеливание — до и после. #бишкек'))
  expect(url.origin).toBe('https://chatgpt.com')
  const q = url.searchParams.get('q')!
  expect(q).toContain('Улучши текст поста для Instagram')
  expect(q).toContain('Нельзя обещать «100%»')
  expect(q.endsWith('Текст:\nОтбеливание — до и после. #бишкек')).toBe(true)
})
