/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Аудит безопасности 2026-11-25: React экранирует всё, что выводится в JSX, — пока код сам не вставляет HTML строкой.
// Храповик: в исходниках (кроме тестов) нет вставки HTML и выполнения строк как кода. Понадобилось — сначала
// санитайзер (DOMPurify) и ревью, потом исключение здесь с причиной.
const ROOTS = ['..', '../../site'].map((p) => fileURLToPath(new URL(p, import.meta.url)))
const FORBIDDEN: [RegExp, string][] = [
  [/dangerouslySetInnerHTML/, 'dangerouslySetInnerHTML'],
  [/\.(innerHTML|outerHTML)\s*\+?=/, 'присваивание innerHTML/outerHTML'],
  [/insertAdjacentHTML|document\.write\(/, 'insertAdjacentHTML / document.write'],
  [/\beval\(|new Function\(/, 'eval / new Function'],
  [/['"`]javascript:/i, 'ссылка javascript:'],
  [/srcdoc/, 'iframe srcdoc'],
]

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : files(path)
    return /\.(ts|tsx|js|html)$/.test(name) && !/\.test\.|schema\.d\.ts$|setupTests|[\\/]test[\\/]/.test(path) ? [path] : []
  })
}

test('в коде фронта нет вставки HTML строкой, eval и ссылок javascript:', () => {
  const found: string[] = []
  const all = ROOTS.flatMap(files)
  expect(all.length).toBeGreaterThan(300)
  expect(all.some((f) => f.endsWith('.html'))).toBe(true)
  for (const file of all) {
    const text = readFileSync(file, 'utf8')
    for (const [pattern, what] of FORBIDDEN) if (pattern.test(text)) found.push(`${file}: ${what}`)
  }
  expect(found).toEqual([])
})
