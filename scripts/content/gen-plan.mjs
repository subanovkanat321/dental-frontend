// Контент-план Instagram: рисует картинки (посты, карусели, сторис) и пишет plan.json.
// Тексты, даты и подписи — в plan-data.mjs рядом; здесь только шаблоны и отрисовка.
//   node scripts/content/gen-plan.mjs [папка]     (по умолчанию public/content)
// Посты по FROZEN_UNTIL включительно уже опубликованы: их картинки и строки plan.json не трогаем
// (берём из готового plan.json), перерисовываем только дни после. Стиль — README.md рядом.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

import { FROZEN_UNTIL, PLAN } from './plan-data.mjs'
import { tishka as tishkaSvg } from './tishka.mjs'

const HERE = path.dirname(new URL(import.meta.url).pathname)
const REPO = path.resolve(HERE, '../..')
const OUT = path.resolve(process.argv[2] ?? path.join(REPO, 'public/content'))
const MODULES = path.join(REPO, 'node_modules')
const FONTS_DIR = process.env.FONTS_DIR ?? path.join(MODULES, '@fontsource')
const EMOJI_DIR = path.join(MODULES, '@lobehub/fluent-emoji-3d/assets')
const PW = [process.env.PLAYWRIGHT, path.join(REPO, '../dental/e2e/node_modules/playwright/index.mjs'), '/home/user/dental/e2e/node_modules/playwright/index.mjs']
  .find((p) => p && fs.existsSync(p))
if (!PW) throw new Error('Нет Playwright: задайте PLAYWRIGHT=…/node_modules/playwright/index.mjs')
const { chromium } = await import(PW)

// ---------- шрифты, логотип, эмодзи (base64 внутри страницы) ----------
const font = (fam, file, w) => `@font-face{font-family:'${fam}';font-weight:${w};src:url(data:font/woff2;base64,${fs.readFileSync(`${FONTS_DIR}/${file}`).toString('base64')}) format('woff2');}`
const FONTS = ['cyrillic', 'cyrillic-ext', 'latin'].flatMap((s) => [
  ...[600, 700].map((w) => font('G', `geologica/files/geologica-${s}-${w}-normal.woff2`, w)),
  ...[400, 500, 600].map((w) => font('T', `golos-text/files/golos-text-${s}-${w}-normal.woff2`, w)),
]).join('')
const LOGO = `data:image/svg+xml;base64,${fs.readFileSync(path.join(REPO, 'public/logo.svg')).toString('base64')}`

/** Объёмные эмодзи Microsoft Fluent Emoji 3D (MIT, пакет @lobehub/fluent-emoji-3d, WebP 256 px). */
const emojiCache = new Map()
function emojiUri(ch) {
  if (!emojiCache.has(ch)) {
    const code = [...ch].map((c) => c.codePointAt(0).toString(16)).join('-')
    const file = [code, code.replaceAll('-fe0f', ''), `${code}-fe0f`].map((c) => path.join(EMOJI_DIR, `${c}.webp`)).find((f) => fs.existsSync(f))
    if (!file) throw new Error(`Нет эмодзи ${ch} (${code}) в @lobehub/fluent-emoji-3d`)
    emojiCache.set(ch, `data:image/webp;base64,${fs.readFileSync(file).toString('base64')}`)
  }
  return emojiCache.get(ch)
}
/** Эмодзи картинкой: размер, поворот и мягкая тень — как наклейка. */
const emo = (ch, size, rot = 0, style = '') => `<img src="${emojiUri(ch)}" alt="" style="display:block;width:${size}px;height:${size}px;transform:rotate(${rot}deg);filter:drop-shadow(0 ${Math.round(size / 18)}px ${Math.round(size / 14)}px rgba(15,42,48,.18));${style}">`
/** Эмодзи в строке текста. */
const iemo = (ch, size = '1.15em') => `<img src="${emojiUri(ch)}" alt="" style="display:inline-block;width:${size};height:${size};vertical-align:-.22em">`
const tishka = (w, pose = 'wave', mood = 'happy') => `<div style="width:${w}px">${tishkaSvg(pose, mood)}</div>`

// ---------- палитра: тёплые пастельные фоны по рубрикам + фирменный бирюзовый ----------
const INK = '#0F2A30'
const TEXT = '#2E464C'
const MUTED = '#5E747A'
const TEAL = '#0E8A80'
const THEMES = {
  tip: { rubric: 'Совет', icon: '💡', bg: '#DDF3EC', blob: '#C4EADF', mark: '#FFE27A' },
  hack: { rubric: 'Лайфхак', icon: '🪥', bg: '#E7F3D9', blob: '#D3E9BE', mark: '#FFE27A' },
  myth: { rubric: 'Миф или правда', icon: '🤔', bg: '#DCEBFA', blob: '#C4DCF5', mark: '#FFE27A' },
  granny: { rubric: 'Бабушкин метод', icon: '👵', bg: '#FFE6D5', blob: '#FFD3B8', mark: '#FFF0A8' },
  kids: { rubric: 'Детям', icon: '🧸', bg: '#FFF0C4', blob: '#FFE29A', mark: '#FFFFFF' },
  quiz: { rubric: 'Угадайте', icon: '❓', bg: '#E9E3FB', blob: '#D8CFF7', mark: '#FFE27A' },
  humor: { rubric: 'Юмор', icon: '😄', bg: '#FFE1E7', blob: '#FFCAD6', mark: '#FFF0A8' },
  fact: { rubric: 'Факт', icon: '🔬', bg: '#DCEFF4', blob: '#C3E3EC', mark: '#FFE27A' },
  clinic: { rubric: 'Клиникам', icon: '🏥', bg: '#E0F2EF', blob: '#C8E8E2', mark: '#FFE27A' },
  calm: { rubric: '', icon: '', bg: '#F4EFE6', blob: '#F4EFE6', mark: '#F4EFE6' },
}
const VERDICT = { 'Миф': '#D93F3F', 'Правда': '#1B8F5A', 'Наполовину': '#C26A12', 'Не надо': '#D93F3F', 'Можно': '#1B8F5A', 'Не совсем': '#C26A12' }

// ---------- каркас ----------
const CSS = `${FONTS}*{box-sizing:border-box;margin:0}
body{overflow:hidden;font-family:T,sans-serif;-webkit-font-smoothing:antialiased;color:${INK}}
.c{position:relative;overflow:hidden}.a{position:absolute}
.fit{position:absolute;display:flex;overflow:hidden}.fit>div{width:100%}
.top{align-items:flex-start}.mid{align-items:center}.bot{align-items:flex-end}.ctr{text-align:center}
.h{font-family:G;font-weight:700;line-height:1.08;letter-spacing:-.025em}
.h em,.p em{font-style:normal;background:linear-gradient(transparent 55%,var(--mark) 55%,var(--mark) 92%,transparent 92%);-webkit-box-decoration-break:clone;box-decoration-break:clone;padding:0 .06em}
.p{font-weight:400;line-height:1.38;color:${TEXT}}.p b{font-weight:600;color:${INK}}
.card{background:#fff;border-radius:40px;box-shadow:0 2px 4px rgba(15,42,48,.05),0 22px 48px rgba(15,42,48,.10)}
.sticker{display:inline-flex;align-items:center;gap:14px;background:#fff;border-radius:999px;padding:14px 30px 14px 20px;font:600 30px T;color:${INK};box-shadow:0 8px 20px rgba(15,42,48,.10)}
.dark{background:${INK};color:#fff}
.brand{display:flex;align-items:center;gap:10px;font:600 30px G;color:${INK};letter-spacing:-.01em}
.brand img{width:40px;height:40px;display:block}
.small{font:500 26px/1.35 T;color:${MUTED}}
.badge{width:128px;height:128px;border-radius:50%;display:flex;align-items:center;justify-content:center;font:700 66px G;color:#fff;background:${TEAL};box-shadow:0 10px 24px rgba(14,138,128,.3)}
.opt{display:flex;align-items:center;gap:28px;background:#fff;border-radius:28px;padding:0 36px;font:600 44px T;color:${INK};box-shadow:0 6px 16px rgba(15,42,48,.08)}
.opt i{font-style:normal;width:66px;height:66px;flex:none;border-radius:50%;background:var(--blob);display:flex;align-items:center;justify-content:center;font:700 34px G}
.stamp{display:inline-block;border:9px solid currentColor;border-radius:24px;padding:10px 34px;font:700 92px G;letter-spacing:.02em;text-transform:uppercase;background:rgba(255,255,255,.75)}
.row{display:flex;gap:26px;align-items:flex-start;margin-bottom:.7em}.row:last-child{margin-bottom:0}.row img{flex:none}
`
const DISCLAIMER = 'Это не заменяет осмотр у стоматолога'
// Эмодзи в тексте — тоже объёмные картинки Fluent (системного цветного шрифта в Chromium может не быть)
const EMOJI = /\p{Extended_Pictographic}\uFE0F?(\u200D\p{Extended_Pictographic}\uFE0F?)*/gu
const nb = (s) => String(s).replaceAll(' — ', '&nbsp;— ').replaceAll(' – ', '&nbsp;– ')
  .replace(/(<[^>]*>)|([^<]+)/g, (m, tag, text) => tag ?? text
    // Типографика: число не отрывается от слова («2 минуты»), короткий предлог — от следующего слова
    .replace(/(\d) (?=[а-яёА-ЯЁ])/g, '$1&nbsp;')
    .replace(/(^|[\s«(]|&nbsp;)([а-яёА-ЯЁ]{1,2}) /g, '$1$2&nbsp;')
    .replace(EMOJI, (e) => iemo(e)))
const fit = (cls, style, html, size) => `<div class="fit ${cls}" style="${style};font-size:${size}px"><div>${nb(html)}</div></div>`

// Детерминированный «случайный» узор: у каждой картинки свой, но при перегенерации тот же
const rng = (seed) => { let x = [...seed].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7); return () => ((x = (x * 1103515245 + 12345) >>> 0) / 2 ** 32) }
const SPARK = (s, color) => `<svg width="${s}" height="${s}" viewBox="0 0 40 40"><path d="M20 2 C22 14 26 18 38 20 C26 22 22 26 20 38 C18 26 14 22 2 20 C14 18 18 14 20 2Z" fill="${color}"/></svg>`
function decor(theme, w, h, seed) {
  if (theme === THEMES.calm) return ''
  const r = rng(seed)
  const blobs = [[-180 + r() * 80, -160 + r() * 80, 560], [w - 300 + r() * 80, h - 380 + r() * 80, 620]]
    .map(([x, y, s]) => `<div class="a" style="left:${x}px;top:${y}px;width:${s}px;height:${s}px;border-radius:50%;background:${theme.blob}"></div>`).join('')
  const sparks = Array.from({ length: 5 }, (_, i) => {
    const x = 40 + r() * (w - 120)
    const y = (i < 2 ? 130 + r() * 140 : h * (0.35 + r() * 0.5))
    return `<div class="a" style="left:${x}px;top:${y}px;opacity:.75">${SPARK(18 + Math.round(r() * 22), i % 2 ? '#fff' : theme.blob)}</div>`
  }).join('')
  return blobs + sparks
}
/** Рукописная стрелка вправо-вниз (SVG). */
const arrow = (w = 150, color = INK, flip = false) => `<svg width="${w}" height="${w * 0.6}" viewBox="0 0 150 90" style="display:block;${flip ? 'transform:scaleX(-1)' : ''}"><path d="M8 18 C 46 76, 104 82, 138 44" stroke="${color}" stroke-width="6" fill="none" stroke-linecap="round"/><path d="M112 40 L140 42 L134 70" stroke="${color}" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`

const page = (w, h, theme, seed, body, header = true, top = 64) => `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head>
<body style="width:${w}px;height:${h}px"><div class="c" style="width:${w}px;height:${h}px;background:${theme.bg};--mark:${theme.mark};--blob:${theme.blob}">
${decor(theme, w, h, seed)}
${header ? `<div class="a" style="top:${top}px;left:72px;right:72px;display:flex;justify-content:space-between;align-items:center">
  <span class="sticker" style="transform:rotate(-3deg)">${theme.icon ? iemo(theme.icon, '40px') : ''}${theme.rubric}</span>
  <div class="brand"><img src="${LOGO}" alt="">Tish</div></div>` : ''}
${body}</div></body></html>`

/** Лента 1080×1350. Подвал: tish.kg и номер слайда (или «листайте →»). */
const feed = (p, body) => page(1080, 1350, p.theme, p.seed, `${body}
  <div class="a small" style="top:1262px;left:80px;right:80px;display:flex;justify-content:space-between"><span>tish.kg</span><span>${p.pageLabel ?? ''}</span></div>`)
/** Сторис 1080×1920: верх ~250 px и низ ~340 px перекрывает интерфейс Instagram — важное между ними. */
const story = (p, body, header = true) => page(1080, 1920, p.theme, p.seed, body, header, 270)

// ---------- макеты интерфейса Tish (вымышленные данные) ----------
const LINE = '#E3EAEA'
const SUNK = '#F3F7F7'
const TINT = '#E0F2EF'
const ui = {
  card: (inner, w = 900) => `<div style="width:${w}px;background:#fff;border-radius:32px;box-shadow:0 2px 4px rgba(15,42,48,.05),0 22px 48px rgba(15,42,48,.12);overflow:hidden">${inner}</div>`,
  head: (title, sub = '') => `<div style="padding:24px 34px;display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid ${LINE}"><span style="font:600 32px G;color:${INK}">${title}</span><span style="font:400 23px T;color:${MUTED}">${sub}</span></div>`,
  row: (a, b, chip, accent = false) => `<div style="display:flex;align-items:center;gap:22px;padding:18px 34px;border-bottom:2px solid ${LINE}">
    <span style="font:500 27px T;color:${INK};min-width:96px">${a}</span><span style="flex:1;font:400 26px/1.3 T;color:${TEXT}">${b}</span>
    ${chip ? `<span style="font:500 22px T;background:${accent ? TINT : SUNK};color:${accent ? TEAL : TEXT};padding:8px 16px;border-radius:10px;white-space:nowrap">${chip}</span>` : ''}</div>`,
  bubble: (text, mine = false, color) => `<div style="max-width:78%;margin:14px ${mine ? '30px 14px auto' : 'auto 14px 30px'};background:${color ?? (mine ? TINT : SUNK)};border-radius:22px;padding:16px 24px;font:400 25px/1.35 T;color:${INK}">${text}</div>`,
  buttons: (list) => `<div style="display:grid;grid-template-columns:repeat(${Math.min(list.length, 3)},1fr);gap:10px;margin:8px 30px 22px">${list.map((x) => `<span style="text-align:center;border:2px solid ${LINE};color:${TEAL};border-radius:12px;padding:12px 6px;font:500 24px T">${x}</span>`).join('')}</div>`,
  total: (label, sum) => `<div style="display:flex;justify-content:space-between;padding:22px 34px;font:600 30px G;color:${INK}"><span>${label}</span><span>${sum}</span></div>`,
  button: (text) => `<div style="padding:18px 34px 26px"><span style="display:inline-block;background:${TEAL};color:#fff;font:500 25px T;padding:14px 28px;border-radius:12px">${text}</span></div>`,
}
const bars = (list) => `<div style="display:flex;align-items:flex-end;gap:18px;height:200px;padding:20px 34px 0">${list.map(([h, l]) => `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:8px"><div style="width:100%;height:${h}px;border-radius:10px 10px 4px 4px;background:${h > 140 ? TEAL : '#9ED5CE'}"></div><span style="font:400 20px T;color:${MUTED}">${l}</span></div>`).join('')}</div>`
const MOCK = {
  booking: ui.card(ui.head('Запись к стоматологу', 'бот в Telegram') + ui.bubble('Выберите время на четверг') + ui.buttons(['10:00', '11:30', '15:00']) + ui.bubble('Четверг, 11:30 · осмотр', true) + ui.bubble('Заявка отправлена. Клиника подтвердит запись.')),
  reminder: ui.card(ui.head('Напоминание', 'накануне вечером') + ui.bubble('Здравствуйте! Завтра в 10:00 у вас приём у стоматолога.') + ui.buttons(['Приду', 'Нужно перенести']) + ui.bubble('Приду', true)),
  schedule: ui.card(ui.head('Завтра', 'кому напомнили') + [
    ['09:00', 'Айгерим К. · осмотр', 'придёт', true], ['10:30', 'Бакыт С. · чистка', 'ждём ответа'],
    ['12:00', 'Элина М. · лечение', 'придёт', true], ['15:30', 'Тимур А. · консультация', 'не напомнили']].map((r) => ui.row(...r)).join('')),
  whatsapp: ui.card(ui.head('Карточка приёма', 'завтра, 14:00') + ui.row('Пациент', 'нет Telegram — только телефон', '') + ui.bubble('Здравствуйте! Напоминаем: завтра в 14:00 приём у стоматолога. Адрес — в профиле клиники.', false, '#DCF8C6')
    + `<div style="padding:8px 34px 26px"><span style="display:inline-block;background:#25D366;color:#fff;font:500 25px T;padding:14px 28px;border-radius:12px">Напомнить в WhatsApp</span></div>`),
  pay: ui.card(ui.head('Приём состоялся', 'оплата') + ui.row('Услуга', 'Лечение кариеса', '3 500 сом') + ui.buttons(['Всё сразу', 'Часть, остальное потом']) + ui.row('Сейчас', 'наличные', '2 000 сом', true) + ui.row('Долг', 'доплатит до 20 ноября', '1 500 сом')),
  debts: ui.card(ui.head('Должники', 'семьи вместе') + [['Асановы', 'семья · 3 человека', '4 500 сом'], ['Бекова Н.', 'лечение · 2 визита', '2 000 сом'], ['Орозовы', 'семья · 2 человека', '1 800 сом']].map((r) => ui.row(...r)).join('')
    + ui.button('Оплатить за семью')),
  analytics: ui.card(ui.head('Аналитика', 'выручка по дням') + bars([[90, 'пн'], [150, 'вт'], [120, 'ср'], [170, 'чт'], [110, 'пт'], [60, 'сб']]) + `<div style="height:22px"></div>` + ui.row('Врачи', 'выручка, услуги, откуда пациенты', '')),
  recall: ui.card(ui.head('Позвать снова', 'пациенты') + [['План', 'Незаконченные планы лечения', '7', true], ['Неявка', 'Не пришли и не перезаписались', '4'], ['Осмотр', 'Пора на осмотр', '12', true]].map((r) => ui.row(...r)).join('')),
  invite: ui.card(ui.head('Пригласить', 'готовый текст') + ui.bubble('Здравствуйте! По плану лечения остался второй этап — пломба на 36-м зубе. Записаться можно кнопкой ниже.') + ui.buttons(['Записаться'])),
  plan: ui.card(ui.head('План лечения', 'отправлен пациенту') + ui.row('1 этап', 'Лечение кариеса, 36', '3 500 сом') + ui.row('2 этап', 'Коронка, 21', '18 000 сом') + ui.buttons(['Согласен с планом', 'Есть вопрос'])),
  back: ui.card(ui.head('Позвать снова', 'итог') + `<div style="padding:30px 34px;font:600 40px G;color:${INK}">За 30 дней вернулись <span style="color:${TEAL}">5 из 12</span></div><div style="padding:0 34px 30px;font:400 24px T;color:${MUTED}">приглашённых — числа вымышленные</div>`),
  dictation: ui.card(ui.head('🎤 Надиктовать', 'карточка приёма') + ui.bubble('«36-й кариес, поставили пломбу; на 21 коронка в плане»', true)
    + `<div style="padding:10px 34px 4px;font:600 26px T;color:${INK}">Проверьте</div>` + ui.row('36', 'пломба', '✓', true) + ui.row('21', 'коронка — в план лечения', '✓', true) + ui.button('Сохранить')),
  salary: ui.card(ui.head('Зарплата · ноябрь', 'оклад + %') + [['Врач 1', 'оклад + % от выручки', '96 400 сом'], ['Врач 2', 'оклад + % от выручки', '71 250 сом'], ['Ассистент', '% от выручки врачей', '24 800 сом']].map((r) => ui.row(...r)).join('')),
  month: ui.card(ui.head('Итог месяца по врачам', 'ноябрь') + [['Врач 1', 'выручка 320 000 · материалы 41 000', 'клинике 118 000', true], ['Врач 2', 'выручка 240 000 · техник 22 000', 'клинике 86 000', true]].map((r) => ui.row(...r)).join('')
    + ui.total('Общие расходы', '95 000 сом')),
  report: ui.card(ui.head('Отчёт · ноябрь', 'все приёмы месяца') + ui.row('412', 'приёмов', '') + ui.row('CSV', 'файл для бухгалтера', '') + ui.button('Отправить в бот')),
  stock: ui.card(ui.head('Склад', 'только заканчивается') + [['Композит A2', 'осталось 2 шприца · минимум 3', 'заканчивается'], ['Анестетик', 'осталось 18 карпул · минимум 20', 'заканчивается']].map((r) => ui.row(...r)).join('')
    + ui.button('＋ Пришла поставка')),
  used: ui.card(ui.head('Обычно уходит', 'пломба, 1 поверхность') + [['1 шт.', 'Анестетик, карпула', ''], ['1 пара', 'Перчатки', ''], ['0,3 г', 'Композит A2', '']].map((r) => ui.row(...r)).join('') + ui.button('Списать всё')),
}
const PHONE_DAY = `<div style="width:380px;height:760px;border-radius:58px;background:${INK};padding:14px;box-shadow:0 30px 60px rgba(15,42,48,.22);transform:rotate(4deg)">
  <div style="width:100%;height:100%;border-radius:46px;background:#fff;overflow:hidden"><div style="padding:46px 26px 18px;border-bottom:2px solid ${LINE}"><div style="font:400 20px T;color:${MUTED}">Расписание</div><div style="font:600 32px G;color:${INK}">Сегодня</div></div>
  ${[['09:00', 'Айгерим К.', 'придёт', '#D3F0DE'], ['10:30', 'Бакыт С.', 'ждём ответа', '#FFEAC0'], ['12:00', 'Элина М.', 'придёт', '#D3F0DE'], ['14:00', 'Свободно', '＋ записать', '#fff'], ['15:30', 'Тимур А.', 'придёт', '#D3F0DE'], ['16:30', 'Нурлан Б.', 'заявка', '#DCE7FF']].map(([t, n, s, bg]) =>
    `<div style="display:flex;gap:14px;margin:8px 12px;padding:12px 14px;border-radius:12px;background:${bg};${bg === '#fff' ? `border:2px dashed ${LINE}` : ''}"><span style="font:500 22px T;color:${INK};width:66px">${t}</span><span style="font:500 22px/1.3 T;color:${n === 'Свободно' ? TEAL : INK}">${n}<br><span style="font-weight:400;color:${MUTED}">${s}</span></span></div>`).join('')}</div></div>`

// ---------- шаблоны ленты (1080×1350) ----------
const save = (rot = 5) => `<span class="sticker" style="background:#FFE27A;transform:rotate(${rot}deg)">${iemo('📌', '38px')}Сохраните</span>`
const swipe = `<div style="display:flex;align-items:center;gap:10px"><span class="sticker dark" style="transform:rotate(-4deg)">Листайте</span>${arrow(120)}</div>`
/** Эмодзи-композиция: главный крупно, остальные — меньше вокруг. */
const cluster = (list = [], size = 340) => {
  const [a, b, c] = list
  return `<div style="position:relative;width:${size * 1.35}px;height:${size * 1.2}px">
    ${a ? `<div class="a" style="right:0;top:${size * 0.1}px">${emo(a, size, 8)}</div>` : ''}
    ${b ? `<div class="a" style="left:0;top:0">${emo(b, size * 0.5, -14)}</div>` : ''}
    ${c ? `<div class="a" style="left:${size * 0.12}px;bottom:0">${emo(c, size * 0.42, 10)}</div>` : ''}</div>`
}
const hero = (p, size) => (p.mascot ? tishka(size, p.mascot.pose, p.mascot.mood) : cluster(p.emoji, size * 0.82))

const T = {
  /** Обложка карусели: крупный заголовок с маркером, подзаголовок, эмодзи или Тишка, «Листайте». */
  cover: (p) => feed(p, `
    ${fit('bot h', 'top:170px;left:80px;right:80px;height:560px', p.title, 112)}
    ${fit('top p', 'top:770px;left:80px;width:520px;height:270px', p.sub, 40)}
    <div class="a" style="right:50px;top:${p.mascot ? 760 : 740}px">${hero(p, 360)}</div>
    <div class="a" style="left:76px;top:1100px">${swipe}</div>
    ${p.save ? `<div class="a" style="left:470px;top:1110px">${save(-3)}</div>` : ''}`),

  /** Шаг карусели: номер в кружке, эмодзи, заголовок, текст на белой карточке и (по желанию) совет-наклейка. */
  step: (p) => feed(p, `
    <div class="a badge" style="top:170px;left:80px;transform:rotate(-6deg)">${p.n}</div>
    <div class="a" style="top:150px;right:80px">${emo(p.emoji ?? '🦷', 250, 8)}</div>
    ${fit('bot h', 'top:330px;left:80px;right:80px;height:250px', p.title, 84)}
    <div class="a card" style="top:620px;left:64px;right:64px;height:${p.tip ? 360 : 560}px"></div>
    ${fit('mid p', `top:620px;left:116px;right:116px;height:${p.tip ? 360 : 560}px`, p.text, 46)}
    ${p.tip ? `<div class="a" style="top:1020px;left:90px;right:90px;height:190px;background:#FFE27A;border-radius:30px;transform:rotate(-1.5deg);box-shadow:0 10px 24px rgba(15,42,48,.10)"></div>
      ${fit('mid p', `top:1020px;left:130px;right:130px;height:190px;color:${INK}`, `${iemo('💡')} <b>Совет:</b> ${p.tip}`, 38)}` : ''}`),

  /** Последний слайд: вывод, кнопка-призыв, «Сохраните», Тишка. */
  final: (p) => feed(p, `
    <div class="a" style="top:150px;right:70px">${tishka(300, p.pose ?? 'party', p.mood ?? 'happy')}</div>
    ${p.save !== false ? `<div class="a" style="top:250px;left:80px">${save(-5)}</div>` : ''}
    ${fit('bot h', 'top:440px;left:80px;right:80px;height:330px', p.title, 92)}
    ${fit('top p', 'top:800px;left:80px;right:80px;height:190px', p.text, 42)}
    ${fit('top', 'top:1010px;left:80px;right:80px;height:120px', `<span class="sticker" style="background:${TEAL};color:#fff;font-size:1em;padding:22px 40px">${p.cta}</span>`, 36)}
    <div class="a small" style="top:1170px;left:80px">${p.disclaimer === false ? '' : DISCLAIMER}</div>`),

  /** Юмор: фраза в облачке Тишки + «А если серьёзно». */
  quote: (p) => feed(p, `
    <div class="a card" style="top:170px;left:64px;right:64px;height:540px;border-radius:56px"></div>
    <div class="a" style="top:690px;left:200px;width:0;height:0;border-left:30px solid transparent;border-right:50px solid transparent;border-top:70px solid #fff;transform:skewX(-18deg)"></div>
    ${fit('mid h', 'top:200px;left:120px;right:120px;height:480px', p.line, 84)}
    <div class="a" style="top:760px;left:60px">${tishka(260, p.pose ?? 'wave', p.mood ?? 'wink')}</div>
    <div class="a" style="top:770px;right:90px">${cluster(p.emoji, 220)}</div>
    <div class="a" style="top:1030px;left:64px;right:64px;height:200px;border-radius:32px;background:rgba(255,255,255,.72)"></div>
    <div class="a" style="top:1048px;left:104px;font:600 28px T;color:${TEAL}">А если серьёзно</div>
    ${fit('top p', `top:1090px;left:104px;right:104px;height:130px;color:${INK}`, p.fact, 34)}`),

  /** «Миф или правда»: утверждение в облачке, штамп-вердикт, объяснение. */
  myth: (p) => feed(p, `
    <div class="a card" style="top:170px;left:64px;right:64px;height:450px;border-radius:56px"></div>
    ${fit('mid h', 'top:200px;left:116px;right:116px;height:390px', `«${p.statement}»`, 72)}
    <div class="a" style="top:600px;left:80px">${emo(p.emoji ?? '🤔', 210, -8)}</div>
    <div class="a" style="top:650px;right:90px;transform:rotate(-8deg);color:${VERDICT[p.verdict] ?? INK}"><span class="stamp">${p.verdict}</span></div>
    ${fit('top p', `top:860px;left:80px;right:80px;height:290px;color:${INK}`, p.explain, 42)}
    <div class="a small" style="top:1190px;left:80px">${DISCLAIMER}</div>`),

  /** «Бабушкин метод vs стоматолог»: два облачка и вердикт. */
  versus: (p) => feed(p, `
    <div class="a" style="top:180px;left:60px">${emo('👵', 190, -6)}</div>
    <div class="a card" style="top:170px;left:280px;right:64px;height:300px;border-radius:44px;background:#FFF8F0"></div>
    <div class="a" style="top:196px;left:324px;font:600 28px T;color:${MUTED}">Бабушка говорит</div>
    ${fit('mid h', 'top:236px;left:324px;right:104px;height:210px', `«${p.granny}»`, 58)}
    <div class="a" style="top:470px;left:300px;transform:rotate(-7deg);color:${VERDICT[p.verdict] ?? INK}"><span class="stamp" style="font-size:66px;border-width:7px">${p.verdict}</span></div>
    <div class="a card" style="top:640px;left:64px;right:270px;height:520px"></div>
    <div class="a" style="top:672px;left:108px;font:600 28px T;color:${TEAL}">Стоматолог</div>
    ${fit('top p', `top:722px;left:108px;right:310px;height:410px;color:${INK}`, p.doctor, 42)}
    <div class="a" style="top:760px;right:50px">${emo('🧑‍⚕️', 210, 6)}</div>
    <div class="a small" style="top:1190px;left:80px">${DISCLAIMER}</div>`),

  /** Вопрос: варианты ответа, ответ — на следующем слайде. */
  quizQ: (p) => feed({ ...p, pageLabel: `${p.pageLabel} · ответ →` }, `
    <div class="a" style="top:180px;left:80px"><span class="sticker dark" style="transform:rotate(-3deg)">${p.label ?? 'Вопрос'}</span></div>
    <div class="a" style="top:140px;right:80px">${emo(p.emoji ?? '🤔', 240, 10)}</div>
    ${fit('bot h', `top:300px;left:80px;right:80px;height:${p.options ? 440 : 600}px`, p.q, 86)}
    ${p.options ? `<div class="a" style="top:790px;left:80px;right:80px;display:flex;flex-direction:column;gap:26px">${p.options.map((o, i) => `<div class="opt" style="height:116px"><i>${'АБВГ'[i]}</i>${o}</div>`).join('')}</div>`
      : `<div class="a" style="top:960px;left:80px;display:flex;align-items:center;gap:22px"><span class="h" style="font-size:150px;color:${TEAL}">?</span><span class="p" style="font-size:42px;color:${INK}">Ваш вариант —<br>в комментарии, ответ →</span></div>`}`),

  /** Ответ на вопрос: крупно, галочка, объяснение. */
  quizA: (p) => feed(p, `
    <div class="a" style="top:180px;left:80px"><span class="sticker" style="background:#1B8F5A;color:#fff;transform:rotate(-3deg)">Ответ</span></div>
    <div class="a" style="top:150px;right:90px">${emo(p.emoji ?? '✅', 210, 8)}</div>
    ${fit('mid h', `top:290px;left:80px;right:80px;height:340px;color:${TEAL}`, p.a, 200)}
    <div class="a card" style="top:680px;left:64px;right:64px;height:520px"></div>
    ${fit('mid p', `top:680px;left:116px;right:116px;height:520px;color:${INK}`, p.text, 46)}`),

  /** Одиночный пост-список: заголовок и пункты с эмодзи на белой карточке. */
  list: (p) => feed(p, `
    ${fit('bot h', 'top:170px;left:80px;right:360px;height:330px', p.title, 84)}
    <div class="a" style="top:150px;right:70px">${p.mascot ? tishka(270, p.mascot.pose, p.mascot.mood) : emo(p.emoji?.[0] ?? '💡', 250, 8)}</div>
    <div class="a card" style="top:540px;left:64px;right:64px;height:620px"></div>
    ${fit('mid p', `top:570px;left:110px;right:110px;height:560px;color:${INK}`, p.items.map(([e, t]) => `<div class="row">${iemo(e, '1.5em')}<span>${t}</span></div>`).join(''), 40)}
    <div class="a small" style="top:1190px;left:80px">${p.disclaimer === false ? '' : DISCLAIMER}</div>`),

  // ---------- клиникам ----------
  b2bCover: (p) => feed(p, `
    ${fit('top h', 'top:190px;left:80px;width:540px;height:560px', p.title, 92)}
    ${fit('top p', 'top:780px;left:80px;width:520px;height:250px', p.sub, 38)}
    <div class="a" style="top:200px;right:70px">${PHONE_DAY}</div>
    <div class="a" style="top:120px;right:20px">${emo(p.emoji ?? '😱', 160, 12)}</div>
    <div class="a small" style="top:990px;right:80px;width:380px;text-align:center">данные — вымышленные</div>
    <div class="a" style="left:76px;top:1100px">${swipe}</div>`),

  /** Шаг «было → с Tish» с макетом экрана. */
  b2bStep: (p) => feed(p, `
    <div class="a badge" style="top:170px;left:80px;width:100px;height:100px;font-size:52px;transform:rotate(-6deg)">${p.n}</div>
    ${fit('mid h', 'top:170px;left:210px;right:80px;height:140px', p.title, 64)}
    <div class="a" style="top:340px;left:80px">${emo('❌', 56)}</div>
    ${fit('top p', 'top:342px;left:160px;right:80px;height:90px', p.was, 32)}
    <div class="a" style="top:450px;left:80px">${emo('✅', 56)}</div>
    ${fit('top p', `top:452px;left:160px;right:80px;height:180px;color:${INK}`, p.now, 34)}
    <div class="a" style="top:650px;left:90px;height:580px;display:flex;align-items:center;overflow:hidden;padding:0 0 20px">${MOCK[p.mock]}</div>`),

  /** Одиночный пост для клиник: заголовок, текст, макет. */
  b2bPost: (p) => feed(p, `
    ${fit('bot h', 'top:160px;left:80px;right:300px;height:300px', p.title, 80)}
    <div class="a" style="top:150px;right:70px">${emo(p.emoji?.[0] ?? '💡', 220, 8)}</div>
    ${fit('top p', `top:490px;left:80px;right:80px;height:200px;color:${INK}`, p.text, 36)}
    <div class="a" style="top:710px;left:90px;height:530px;overflow:hidden;padding:0 0 30px">${MOCK[p.mock]}</div>`),

  // ---------- сторис 1080×1920 ----------
  /** Вопрос: эмодзи, вопрос, варианты; «ответ — в следующей сторис». */
  sQ: (p) => story(p, `
    <div class="a" style="top:390px;left:0;right:0;display:flex;justify-content:center">${p.granny ? emo('👵', 340, -6) : cluster(p.emoji, 330)}</div>
    ${fit('mid h ctr', `top:810px;left:80px;right:80px;height:${p.options ? 350 : 560}px`, p.q, 96)}
    ${p.options ? `<div class="a" style="top:1180px;left:80px;right:80px;display:flex;flex-direction:column;gap:18px">${p.options.map((o, i) => `<div class="opt" style="height:92px;font-size:40px"><i>${'АБВ'[i]}</i>${o}</div>`).join('')}</div>` : ''}
    <div class="a" style="top:${p.options ? 1180 + p.options.length * 110 + 14 : 1440}px;left:0;right:0;display:flex;justify-content:center;align-items:center;gap:10px"><span class="sticker dark" style="transform:rotate(-3deg)">Ответ — в следующей сторис</span>${arrow(110, INK)}</div>`),

  /** Ответ: вердикт штампом или крупно, объяснение на карточке. */
  sA: (p) => story(p, `
    <div class="a" style="top:380px;right:90px">${emo(p.emoji ?? '✅', 260, 8)}</div>
    ${p.verdict ? `<div class="a" style="top:470px;left:90px;transform:rotate(-8deg);color:${VERDICT[p.verdict] ?? INK}"><span class="stamp" style="font-size:110px">${p.verdict}</span></div>`
      : fit('mid h', `top:400px;left:90px;right:380px;height:330px;color:${TEAL}`, p.a, 150)}
    <div class="a card" style="top:780px;left:64px;right:64px;height:640px"></div>
    ${fit('mid p', `top:780px;left:120px;right:120px;height:640px;color:${INK}`, p.text, 54)}
    <div class="a small" style="top:1460px;left:80px;right:80px;text-align:center;font-size:30px">${p.foot ?? DISCLAIMER}</div>`),

  /** Факт: эмодзи или Тишка, крупное слово, заголовок, текст. */
  sFact: (p) => story(p, `
    <div class="a" style="top:380px;left:0;right:0;display:flex;justify-content:center">${p.mascot ? tishka(400, p.mascot.pose, p.mascot.mood) : emo(p.emoji?.[0] ?? '💡', 360, -6)}</div>
    ${fit('mid h ctr', 'top:800px;left:80px;right:80px;height:300px', p.title, 104)}
    <div class="a card" style="top:1140px;left:64px;right:64px;height:400px"></div>
    ${fit('mid p ctr', `top:1140px;left:110px;right:110px;height:400px;color:${INK}`, p.text, 50)}`),

  /** Совет-список в сторис. */
  sList: (p) => story(p, `
    ${fit('bot h', 'top:400px;left:80px;right:360px;height:330px', p.title, 92)}
    <div class="a" style="top:390px;right:70px">${p.mascot ? tishka(280, p.mascot.pose, p.mascot.mood) : emo(p.emoji?.[0] ?? '💡', 260, 8)}</div>
    <div class="a card" style="top:780px;left:64px;right:64px;height:740px"></div>
    ${fit('mid p', `top:810px;left:110px;right:110px;height:680px;color:${INK}`, p.items.map(([e, t]) => `<div class="row">${iemo(e, '1.5em')}<span>${t}</span></div>`).join(''), 46)}`),

  /** Клиникам в сторис: заголовок и макет. */
  sB2B: (p) => story(p, `
    ${fit('bot h', 'top:400px;left:80px;right:300px;height:380px', p.title, 88)}
    <div class="a" style="top:400px;right:70px">${emo(p.emoji?.[0] ?? '📦', 220, 8)}</div>
    ${fit('top p', `top:810px;left:80px;right:80px;height:220px;color:${INK}`, p.text, 42)}
    <div class="a" style="top:1060px;left:90px;height:520px;overflow:hidden;padding:0 0 30px">${MOCK[p.mock]}</div>`),

  /** Спокойная сторис (памятные дни): только текст по центру, без рубрики, эмодзи и юмора. */
  sCalm: (p) => story(p, `
    ${fit('mid h ctr', 'top:620px;left:110px;right:110px;height:440px;font-weight:600', p.title, 76)}
    <div class="a" style="top:1100px;left:510px;width:60px;height:3px;background:${MUTED}"></div>
    ${fit('top p ctr', 'top:1140px;left:130px;right:130px;height:280px', p.text, 42)}`, false),
}

/** Карусель: обложка + шаги (номер n) + финал; номер слайда в подвале. */
function expand(item) {
  const theme = THEMES[item.theme]
  if (!theme) throw new Error(`Нет темы ${item.theme} у ${item.slug}`)
  let slides = item.slides
  if (item.carousel) {
    const { cover, steps, final } = item.carousel
    let n = 0
    slides = [{ t: item.theme === 'clinic' ? 'b2bCover' : 'cover', ...cover },
      ...steps.map((s) => ({ ...s, n: s.t === 'step' || s.t === 'b2bStep' ? ++n : undefined })), { t: 'final', ...final }]
  }
  return slides.map((s, i) => ({
    ...s, theme, seed: `${item.slug}-${i}`,
    pageLabel: slides.length > 1 && item.kind !== 'STORIES' ? (i === 0 ? 'листайте →' : `${i + 1} / ${slides.length}`) : '',
  }))
}

// ---------- рендер ----------
const DAY = /^(\d{4}-\d{2}-\d{2})-.+\.png$/
fs.mkdirSync(OUT, { recursive: true })
for (const item of PLAN) {
  if (item.date <= FROZEN_UNTIL) throw new Error(`${item.date} ${item.slug}: дни по ${FROZEN_UNTIL} уже опубликованы — их в plan-data не держим`)
}
// Опубликованное — как есть: строки plan.json и картинки по FROZEN_UNTIL включительно
const planFile = path.join(OUT, 'plan.json')
const kept = fs.existsSync(planFile) ? JSON.parse(fs.readFileSync(planFile, 'utf8')).filter((p) => p.date <= FROZEN_UNTIL) : []
for (const f of fs.readdirSync(OUT)) {
  const m = f.match(DAY)
  if (m && m[1] > FROZEN_UNTIL) fs.unlinkSync(path.join(OUT, f))
}
const browser = await chromium.launch()
const pg = await (await browser.newContext({ deviceScaleFactor: 1 })).newPage()
const files = []
const plan = []
let mascots = 0
let problems = 0
for (const item of [...PLAN].sort((a, b) => a.date.localeCompare(b.date))) {
  const slides = expand(item)
  const images = []
  for (const [i, s] of slides.entries()) {
    const html = T[s.t](s)
    if (html.includes('viewBox="-40 0 400 380"')) mascots++
    const tall = html.includes('height:1920px')
    await pg.setViewportSize({ width: 1080, height: tall ? 1920 : 1350 })
    await pg.setContent(html)
    await pg.evaluate(() => document.fonts.ready)
    // Ужать шрифт, пока текст не влезет в свою рамку; картинки должны загрузиться
    const bad = await pg.evaluate(() => {
      const left = []
      for (const o of document.querySelectorAll('.fit')) {
        const inner = o.firstElementChild
        let size = parseFloat(getComputedStyle(o).fontSize)
        const over = () => inner.scrollWidth > o.clientWidth + 1 || inner.offsetHeight > o.clientHeight + 1
        while (over() && size > 20) { size -= 2; o.style.fontSize = `${size}px` }
        if (over()) left.push(`не влезло: ${inner.textContent.slice(0, 40)}`)
      }
      for (const img of document.images) if (!img.complete || img.naturalWidth === 0) left.push('картинка не загрузилась')
      return left
    })
    if (bad.length) { problems++; console.warn(`! ${item.slug}-${i + 1}:`, bad) }
    const name = slides.length > 1 ? `${item.date}-${item.slug}-${i + 1}.png` : `${item.date}-${item.slug}.png`
    await pg.screenshot({ path: path.join(OUT, name) })
    files.push(path.join(OUT, name))
    images.push(`/content/${name}`)
  }
  plan.push({ date: item.date, kind: item.kind, title: item.title, caption: item.caption ?? '', images, note: item.note ?? '' })
}
await browser.close()
fs.writeFileSync(planFile, `${JSON.stringify([...kept, ...plan], null, 2)}\n`)

// ---------- сжатие: pngquant, иначе Pillow (палитра 256 цветов) ----------
const has = (cmd) => { try { execFileSync('sh', ['-c', `command -v ${cmd}`]); return true } catch { return false } }
if (has('pngquant')) {
  execFileSync('pngquant', ['--force', '--ext', '.png', '--quality', '70-95', '--skip-if-larger', ...files])
} else {
  execFileSync('python3', ['-I', '-c', `import sys
from PIL import Image
for f in sys.argv[1:]:
    Image.open(f).convert('RGB').quantize(256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG).save(f, optimize=True)`, ...files])
}
const total = files.reduce((s, f) => s + fs.statSync(f).size, 0)
const biggest = Math.max(...files.map((f) => fs.statSync(f).size))
console.log(`Готово: ${kept.length} опубликованных оставлены как есть, ${plan.length} новых единиц плана, ${files.length} картинок (Тишка — на ${mascots}), `
  + `${(total / 1024 / 1024).toFixed(1)} МБ, самая большая ${Math.round(biggest / 1024)} КБ → ${OUT}`)
if (problems) { console.error(`Проблемы на ${problems} картинках — см. выше`); process.exitCode = 1 }
