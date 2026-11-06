/** Подписи «Платформа → Материалы» (MaterialsTab): размер, названия роликов и папок по именам файлов, ссылки. */

import { TISH_INSTAGRAM, TISH_INSTAGRAM_NAME } from '../lib/brand'

/** 17 350 336 байт → «16,5 МБ»; мелкое — в КБ. */
export function sizeText(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} МБ`
  return `${Math.max(1, Math.round(bytes / 1024))} КБ`
}

/** Ролики-инструкции в корне docs/marketing/video — по имени файла. */
const TITLES: Record<string, string> = {
  'kak-zapisatsya': 'Как записаться',
  'kak-ustanovit': 'Как установить приложение',
  'kak-ostavit-zayavku': 'Как оставить заявку',
}

/**
 * Понятная подпись ролика по имени файла: «promo-v4-tatyna-9x16-nosubs.mp4» → «Ролик — голос Татыны, для
 * телефона (9:16), без субтитров». В promo-v4 два голоса — без «tatyna» в имени озвучивает Канат; субтитры
 * вшиты в v3 и v4, «-nosubs» — версия без них. Незнакомое имя — как есть, без расширения.
 */
export function videoLabel(name: string, folder: string): string {
  const base = name.replace(/\.[^.]+$/, '')
  const known = Object.entries(TITLES).find(([key]) => base === key || base.startsWith(`${key}-`))
  if (known) return known[1]
  const format = /16x9|horizontal/.test(base) ? 'для компьютера (16:9)' : /9x16|vertical/.test(base) ? 'для телефона (9:16)' : null
  if (!format) return base
  const parts: string[] = []
  if (/tatyna/.test(base)) parts.push('голос Татыны')
  else if (folder.startsWith('promo-v4')) parts.push('голос Каната')
  parts.push(format)
  if (/nosubs/.test(base)) parts.push('без субтитров')
  else if (/promo-v[34]/.test(folder)) parts.push('с субтитрами')
  return `${/^short/.test(base) ? 'Короткий ролик' : 'Ролик'} — ${parts.join(', ')}`
}

/** Подпись папки роликов: «promo-v4» → «Промо-ролик v4», корень раздела — инструкции. */
export function folderTitle(folder: string): string {
  if (folder === '') return 'Инструкции для клиник и пациентов'
  const promo = /^promo-v(\d+)(\/clips)?$/.exec(folder)
  if (promo) return promo[2] ? `Промо v${promo[1]} · клипы-исходники` : `Промо-ролик v${promo[1]}`
  return folder
}

/** Номер версии promo-vN — новые сверху; остальные папки — после, по имени. */
export function folderRank(folder: string): number {
  const promo = /^promo-v(\d+)$/.exec(folder)
  return promo ? -Number(promo[1]) : 0
}

/** Ссылки «под рукой»: сайт-визитка для клиник и Instagram платформы. */
export const MATERIAL_LINKS = [
  { title: 'Сайт-визитка для клиник', url: 'https://tish.kg/about' },
  { title: `Instagram ${TISH_INSTAGRAM_NAME}`, url: TISH_INSTAGRAM },
]
