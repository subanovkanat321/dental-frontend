// Пиктограммы презентаций «Показать пациенту» — из открытого набора Health Icons
// (https://healthicons.org, Resolve to Save Lives; иконки — CC0 1.0, пакет @iconify-json/healthicons — MIT).
// Берём только нужные (контурные, 48×48) и пишем их в src/learn/icons.gen.tsx готовыми JSX-элементами:
// в сборку попадают ~20 иконок, а не весь набор (3 МБ), и не нужен innerHTML.
//   node scripts/learn-icons.mjs                       — из node_modules (npm ci)
//   node scripts/learn-icons.mjs путь/к/icons.json     — из распакованного пакета
// Новая иконка: добавить строку в NEEDED (имя у нас → имя в наборе, см. https://healthicons.org) и запустить.
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const NEEDED = {
  syringe: 'syringe-outline', // анестезия
  tooth: 'tooth-outline',
  treat: 'odontology-outline', // лечение зуба
  implant: 'odontology-implant-outline',
  brush: 'dental-hygiene-outline', // щётка, паста
  calendar: 'calendar-outline', // визиты, осмотр
  time: 'i-schedule-school-date-time-outline', // сколько времени
  search: 'medical-search-outline', // осмотр, диагностика
  scan: 'tac-outline', // КТ
  camera: 'camera-outline', // скан, слепок
  smoking: 'smoking-cessation-outline',
  sugar: 'sugar-free-outline',
  phone: 'phone-outline',
  fever: 'high-temp-outline',
  pills: 'medicines-outline',
  cold: 'cold-chain-outline',
  meal: 'hot-meal-outline',
  bandage: 'bandage-adhesive-outline',
  spray: 'spray-outline',
  alert: 'alert-circle-outline',
  check: 'yes-outline',
  no: 'cancel-outline',
  shield: 'health-outline', // защита: фтор, герметик, коронка
  heat: 'heat-therapy-outline',
  child: 'child-care-outline',
  records: 'medical-records-outline', // памятка
}

const require = createRequire(import.meta.url)
const file = process.argv[2] ?? require.resolve('@iconify-json/healthicons/icons.json')
const set = JSON.parse(readFileSync(file, 'utf8'))
const info = JSON.parse(readFileSync(file.replace(/icons\.json$/, 'info.json'), 'utf8'))

/** SVG-разметка иконки → JSX: атрибуты через дефис → camelCase (fill-rule → fillRule). */
const toJsx = (body) => body
  .replace(/\s([a-z]+)-([a-z])([a-z]*)=/g, (_m, a, b, c) => ` ${a}${b.toUpperCase()}${c}=`)
  .replace(/<(path|circle|rect|ellipse)([^>]*?)\s*\/?>(<\/\1>)?/g, '<$1$2 />')

const lines = Object.entries(NEEDED).map(([name, src]) => {
  const icon = set.icons[src]
  if (!icon) throw new Error(`Нет иконки ${src} в наборе`)
  if ((icon.width ?? set.width) !== 48 || (icon.height ?? set.height) !== 48) throw new Error(`${src}: не 48×48`)
  if (/<(?!\/?(g|path)\b)/.test(icon.body)) throw new Error(`${src}: кроме g и path есть другие элементы`)
  return `  ${name}: <>${toJsx(icon.body)}</>,`
})

writeFileSync('src/learn/icons.gen.tsx', `// Сгенерировано scripts/learn-icons.mjs — не править руками.
// ${info.name} ${info.version} (https://healthicons.org), ${info.author.name}: иконки — CC0 1.0 (общественное достояние),
// пакет @iconify-json/healthicons — ${info.license.spdx}. Контурные, 48×48, цвет — currentColor.
import type { ReactNode } from 'react'

export const ICONS = {
${lines.join('\n')}
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof ICONS
`)
console.log(`src/learn/icons.gen.tsx: ${lines.length} иконок из ${file}`)
