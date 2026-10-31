// Контракт API берётся из репозитория бэкенда: ../dental/docs/api/openapi.json (оба
// репозитория склонированы рядом). Копируем в api/openapi.json и генерируем типы TypeScript.
// Оба файла — в git: изменение API видно в диффе этого репозитория.
//   npm run api:sync               — из ../dental
//   DENTAL_REPO=путь npm run api:sync
import { copyFileSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { resolve } from 'node:path'

const source = resolve(process.env.DENTAL_REPO ?? '../dental', 'docs/api/openapi.json')
if (!existsSync(source)) {
  console.error(`Нет ${source}. Склонируйте subanovkanat321/dental рядом или задайте DENTAL_REPO`)
  process.exit(1)
}
copyFileSync(source, 'api/openapi.json')
execSync('npm run api:types', { stdio: 'inherit' })
console.log(`Контракт обновлён из ${source}`)
