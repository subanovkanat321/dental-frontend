/**
 * Подписи и группы «Платформа → Материалы» (MaterialsTab): материал → группа по назначению («для чего»),
 * понятное название, обложка, длительность, размер, ссылки.
 */

import type { Schemas } from '../api/client'
import { TISH_INSTAGRAM, TISH_INSTAGRAM_NAME } from '../lib/brand'

export type Material = Schemas['MaterialsMaterial']

/** 17 350 336 байт → «16,5 МБ»; мелкое — в КБ. */
export function sizeText(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} МБ`
  return `${Math.max(1, Math.round(bytes / 1024))} КБ`
}

/** 64 → «1:04», 22 → «0:22». */
export function durationText(seconds?: number | null): string | null {
  if (seconds == null) return null
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/** Старые ролики для Instagram в корне docs/marketing/video — по имени файла. */
const TITLES: Record<string, string> = {
  'kak-zapisatsya': 'Как записаться через Telegram (пациентам)',
  'kak-ustanovit': 'Как установить Tish на телефон',
  'kak-ostavit-zayavku': 'Как клинике оставить заявку',
}

/** Рилсы про зубы (docs/marketing/reels/<папка>) — названия из их README. */
const REELS: Record<string, string> = {
  '01-chistish-nepravilno': 'Ты чистишь зубы неправильно',
  '02-chto-dumaet-stomatolog': 'Что думает стоматолог',
  '03-skolko-sahara': 'Сколько сахара',
  '04-mif-ili-pravda': 'Миф или правда?',
  '05-kak-chasto-menyat-shchyotku': 'Как часто менять щётку',
  '06-stomatolog-vs-pacient': 'Стоматолог vs пациент',
  '07-kak-stavyat-plombu': 'Как ставят пломбу',
  '08-kak-lechat-kanaly': 'Как лечат каналы',
  '09-kak-stavyat-koronku': 'Как ставят коронку',
  '10-kak-stavyat-implant': 'Как ставят имплант',
  '11-professionalnaya-chistka': 'Профчистка крупным планом',
}

const base = (name: string) => name.replace(/\.[^.]+$/, '')

/**
 * Понятная подпись файла. howTo — названия роликов «Как сделать» с сервера (id → название).
 * Незнакомое имя — как есть, без расширения.
 */
export function materialTitle(f: Pick<Material, 'name' | 'section' | 'folder' | 'kind'>, howTo: Record<string, string> = {}): string {
  const name = base(f.name ?? '')
  if (f.section === 'howto') return howTo[name] ?? name
  if (f.section === 'reels') {
    const title = REELS[f.folder ?? ''] ?? f.folder ?? name
    return /bez-muzyki/.test(name) ? `${title} — без музыки` : title
  }
  if (f.section === 'presentation') return f.kind === 'pdf' ? 'Презентация · PDF' : f.kind === 'pptx' ? 'Презентация · PowerPoint (править)' : name
  if (f.section === 'guide') return 'Руководство Tish · PDF'
  if (f.section === 'video') {
    const known = Object.entries(TITLES).find(([key]) => name === key || name.startsWith(`${key}-`))
    if (known) return known[1]
    const format = /4x5/.test(name) ? 'для ленты (4:5)' : /9x16|vertical/.test(name) ? 'для телефона (9:16)' : /16x9|horizontal/.test(name) ? 'для компьютера (16:9)' : null
    if (format) return `Ролик ${format}`
  }
  return name
}

/** Группа по назначению: подпись «для чего» одной строкой и порядок на экране. */
export type Group = { id: string; title: string; purpose: string }

export const GROUPS: Group[] = [
  { id: 'promo', title: 'Рекламный ролик', purpose: 'Клиникам при продаже: отправить в WhatsApp тем, кто ответил; он же — на tish.kg/join.' },
  { id: 'presentation', title: 'Презентация', purpose: 'Показать клинике на встрече; PDF — отправить после встречи.' },
  { id: 'guide', title: 'Инструкция для клиник', purpose: 'Отправить клинике или распечатать: всё руководство Tish одним PDF.' },
  { id: 'howto', title: 'Ролики «Как сделать»', purpose: 'Врачам и сотрудникам: в группу Tish (кнопкой в боте) и в приложении — «Помощь → Видео».' },
  { id: 'reels', title: 'Рилсы про зубы', purpose: 'Для Instagram Tish — пациентам, без рекламы приложения. Опубликовали — сохраните ссылку на пост.' },
  { id: 'instagram', title: 'Картинки для Instagram', purpose: 'Посты и аватар Instagram Tish. Опубликовали — сохраните ссылку на пост.' },
  { id: 'social', title: 'Старые ролики для Instagram', purpose: 'Как записаться, установить Tish и оставить заявку — для Instagram и сторис.' },
  { id: 'old', title: 'Прежние версии рекламного ролика', purpose: 'Заменены актуальным роликом выше — не отправляйте клиникам.' },
  { id: 'other', title: 'Другое', purpose: 'Файлы без группы.' },
]

/** Номер версии папки promo-vN; не promo — null. */
function promoVersion(folder: string): number | null {
  const m = /^promo-v(\d+)(\/|$)/.exec(folder)
  return m ? Number(m[1]) : null
}

/** Картинка — обложка ролика из той же папки (её показываем превью, а не отдельной строкой). */
export function isCover(f: Material, all: Material[]): boolean {
  return f.kind === 'image' && f.section !== 'instagram' && all.some((v) => v.kind === 'video' && posterOf(v, all) === f)
}

/**
 * Обложка ролика: «zapis.webp» рядом с «zapis.mp4», «kak-zapisatsya-cover.png», «cover-4x5.png» под формат,
 * просто «cover.png» в папке. Нет — null (превью — первый кадр).
 */
export function posterOf(v: Material, all: Material[]): Material | null {
  const name = base(v.name ?? '')
  const same = all.filter((f) => f.kind === 'image' && f.section === v.section && (f.folder ?? '') === (v.folder ?? '') && f.url)
  const format = /4x5/.test(name) ? '4x5' : /9x16/.test(name) ? '9x16' : null
  const want = [`${name}.webp`, `${name}.png`, `${name}-cover.png`, ...(format ? [`cover-${format}.png`] : []), 'cover.png', 'cover-4x5.png']
  for (const w of want) {
    const found = same.find((f) => f.name === w)
    if (found) return found
  }
  return null
}

/** Версия «без музыки» рилса — в карточке основного ролика, отдельной карточкой не идёт. */
export function noMusicOf(v: Material, all: Material[]): Material | null {
  if (v.kind !== 'video') return null
  const name = `${base(v.name ?? '')}-bez-muzyki.mp4`
  return all.find((f) => f.name === name && (f.folder ?? '') === (v.folder ?? '') && f.section === v.section) ?? null
}

/** Материалы по группам — в порядке GROUPS; обложки роликов, версии «без музыки» и пустые группы убраны. */
export function groupMaterials(files: Material[]): { group: Group; files: Material[] }[] {
  const latest = Math.max(0, ...files.filter((f) => f.section === 'video').map((f) => promoVersion(f.folder ?? '') ?? 0))
  const groupOf = (f: Material): string => {
    switch (f.section) {
      case 'video': {
        const v = promoVersion(f.folder ?? '')
        if (v == null) return 'social'
        return v === latest ? 'promo' : 'old'
      }
      case 'howto': case 'reels': case 'instagram': case 'presentation': case 'guide': return f.section
      default: return 'other'
    }
  }
  const shown = files.filter((f) => !isCover(f, files) && !files.some((main) => noMusicOf(main, files) === f))
  return GROUPS.map((group) => ({ group, files: shown.filter((f) => groupOf(f) === group.id) })).filter((g) => g.files.length > 0)
}

/** Где опубликовано: «Instagram» или «Telegram» по ссылке. */
export function postPlace(url: string): string {
  return /instagram\.com/.test(url) ? 'Instagram' : 'Telegram'
}

/** Ссылки «под рукой»: сайт-визитка для клиник и Instagram платформы. */
export const MATERIAL_LINKS = [
  { title: 'Сайт-визитка для клиник', url: 'https://tish.kg/about' },
  { title: 'Страница подключения с роликом и кейсом', url: 'https://tish.kg/join' },
  { title: `Instagram ${TISH_INSTAGRAM_NAME}`, url: TISH_INSTAGRAM },
]
