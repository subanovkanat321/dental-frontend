// Контент-план Instagram: рисует картинки (посты, карусели, сторис, обложки рилсов) и пишет plan.json.
// Тексты, даты и подписи — в plan-data.mjs рядом; здесь только шаблоны и отрисовка.
//   node scripts/content/gen-plan.mjs [папка]     (по умолчанию public/content)
// Стиль: белый фон, один акцент — фирменный бирюзовый, Geologica + Golos Text, поля 96 px,
// одинаковые шапка и подвал на всех картинках. Тишка — редко и небольшой. Подробнее — README.md рядом.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

import { PLAN } from './plan-data.mjs'

const HERE = path.dirname(new URL(import.meta.url).pathname)
const REPO = path.resolve(HERE, '../..')
const OUT = path.resolve(process.argv[2] ?? path.join(REPO, 'public/content'))
const FONTS_DIR = process.env.FONTS_DIR ?? path.join(REPO, 'node_modules/@fontsource')
const PW = [process.env.PLAYWRIGHT, path.join(REPO, '../dental/e2e/node_modules/playwright/index.mjs'), '/home/user/dental/e2e/node_modules/playwright/index.mjs']
  .find((p) => p && fs.existsSync(p))
if (!PW) throw new Error('Нет Playwright: задайте PLAYWRIGHT=…/node_modules/playwright/index.mjs')
const { chromium } = await import(PW)

// ---------- шрифты и картинки (base64 внутри страницы) ----------
const font = (fam, file, w) => `@font-face{font-family:'${fam}';font-weight:${w};src:url(data:font/woff2;base64,${fs.readFileSync(`${FONTS_DIR}/${file}`).toString('base64')}) format('woff2');}`
const FONTS = ['cyrillic', 'cyrillic-ext', 'latin'].flatMap((s) => [
  ...[500, 600].map((w) => font('G', `geologica/files/geologica-${s}-${w}-normal.woff2`, w)),
  ...[400, 500, 600].map((w) => font('T', `golos-text/files/golos-text-${s}-${w}-normal.woff2`, w)),
]).join('')
const svgUri = (file) => `data:image/svg+xml;base64,${fs.readFileSync(path.join(REPO, 'public', file)).toString('base64')}`
const LOGO = svgUri('logo.svg')
const TISHKA = svgUri('tishka-icon.svg')

// ---------- палитра: нейтральные + один акцент ----------
const C = {
  ink: '#0F2A30', text: '#3A5056', muted: '#75898E', line: '#E3EAEA',
  teal: '#0E8A80', tint: '#EEF6F4', paper: '#FFFFFF', sunk: '#F5F8F8',
}

// ---------- линейные иконки 48×48 ----------
const ICON = {
  brush: '<g transform="rotate(-40 24 26)"><rect x="2" y="26" width="28" height="8" rx="4"/><rect x="30" y="24" width="15" height="10" rx="3"/><path d="M33 24v-7M37.5 24v-7M42 24v-7"/></g>',
  clock: '<circle cx="24" cy="24" r="17"/><path d="M24 14v10l7 5"/>',
  tooth: '<path d="M15 7c-6 0-9 5-9 10 0 6 3 9 4 15 1 5 2 10 5 10 4 0 3-8 6-11 2-2 4-2 6 0 3 3 2 11 6 11 3 0 4-5 5-10 1-6 4-9 4-15 0-5-3-10-9-10-4 0-6 2-9 2s-5-2-9-2z"/>',
  calendar: '<rect x="7" y="10" width="34" height="31" rx="4"/><path d="M7 19h34M16 6v8M32 6v8"/>',
  drop: '<path d="M24 6c7 10 13 17 13 24a13 13 0 0 1-26 0c0-7 6-14 13-24z"/>',
  wave: '<path d="M6 18c6-6 12 6 18 0s12 6 18 0M6 30c6-6 12 6 18 0s12 6 18 0"/>',
  phone: '<rect x="13" y="5" width="22" height="38" rx="4"/><path d="M21 37h6"/>',
  users: '<circle cx="18" cy="17" r="6"/><path d="M6 39c0-7 5-12 12-12s12 5 12 12"/><circle cx="33" cy="15" r="5"/><path d="M33 25c6 0 10 4 10 10"/>',
  chat: '<path d="M8 10h32v22H20l-8 7v-7H8z"/><path d="M15 18h18M15 24h11"/>',
  search: '<circle cx="21" cy="21" r="12"/><path d="M30 30l10 10"/>',
  child: '<circle cx="24" cy="12" r="6"/><path d="M14 42V29c0-5 4-9 10-9s10 4 10 9v13"/><path d="M20 42v-9h8v9"/>',
  bottle: '<path d="M20 4h8v8l4 6v22H16V18l4-6z"/><path d="M16 26h16"/>',
  spark: '<path d="M24 6l4 14 14 4-14 4-4 14-4-14-14-4 14-4z"/>',
  question: '<circle cx="24" cy="24" r="18"/><path d="M19 19a5 5 0 1 1 7 5c-2 1-2 2-2 4M24 33v1"/>',
  check: '<path d="M10 25l9 9 19-20"/>',
  face: '<circle cx="24" cy="24" r="18"/><path d="M17 32c4-3 10-3 14 0M18 19v2M30 19v2"/>',
  thread: '<path d="M10 38C18 30 14 18 24 10M24 10c6 8 2 20 14 28"/><circle cx="24" cy="10" r="3"/>',
  list: '<path d="M18 12h22M18 24h22M18 36h22"/><path d="M8 12h2M8 24h2M8 36h2"/>',
  cup: '<path d="M8 16h26v12a11 11 0 0 1-11 11h-4A11 11 0 0 1 8 28z"/><path d="M34 19h3a5 5 0 0 1 0 10h-3M16 6v5M22 6v5M28 6v5"/>',
  wallet: '<rect x="6" y="12" width="36" height="26" rx="4"/><path d="M6 19h36M30 28h6"/>',
}
const icon = (name, size = 48, color = C.teal, sw = 2.2) => `<svg width="${size}" height="${size}" viewBox="0 0 48 48" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" style="display:block">${ICON[name]}</svg>`
const tishka = (w) => `<img src="${TISHKA}" style="display:block;width:${w}px;height:auto" alt="">`

// ---------- каркас ----------
const CSS = `${FONTS}*{box-sizing:border-box;margin:0}
body{overflow:hidden;font-family:T,sans-serif;-webkit-font-smoothing:antialiased}
.c{position:relative;overflow:hidden}.a{position:absolute}
.fit{position:absolute;display:flex;overflow:hidden}.fit>div{width:100%}
.top{align-items:flex-start}.mid{align-items:center}.bot{align-items:flex-end}
.h{font-family:G;font-weight:600;line-height:1.06;letter-spacing:-.022em}
.h em{font-style:normal;color:${C.teal}}
.p{font-weight:400;line-height:1.42}
.rub{display:flex;align-items:center;gap:14px;font:500 28px T;color:${C.teal}}
.rub b{width:12px;height:12px;border-radius:50%;background:${C.teal};display:block}
.brand{display:flex;align-items:center;gap:12px;font:600 30px G;color:${C.ink};letter-spacing:-.01em}
.brand img{width:40px;height:40px;display:block}
.rule{width:72px;height:4px;background:${C.teal};border-radius:2px}
.pill{display:inline-block;border-radius:999px;font:600 34px T;padding:20px 40px;line-height:1.2}
.small{font:400 24px/1.4 T;color:${C.muted}}
`
const DISCLAIMER = 'Это не заменяет осмотр у стоматолога'
const nb = (s) => String(s).replaceAll(' — ', '&nbsp;— ').replaceAll(' – ', '&nbsp;– ')
const fit = (cls, style, html, size) => `<div class="fit ${cls}" style="${style};font-size:${size}px"><div>${nb(html)}</div></div>`
const doc = (w, h, body, bg = C.paper) => `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body style="width:${w}px;height:${h}px">
<div class="c" style="width:${w}px;height:${h}px;background:${bg};color:${C.ink}">${body}</div></body></html>`
const head = (rubric, top) => `<div class="a" style="top:${top}px;left:96px;right:96px;display:flex;justify-content:space-between;align-items:center">
  <div class="rub">${rubric ? `<b></b>${rubric}` : ''}</div><div class="brand"><img src="${LOGO}" alt="">Tish</div></div>`
const foot = (page = '') => `<div class="a small" style="top:1222px;left:96px;right:96px;border-top:2px solid ${C.line};padding-top:22px;display:flex;justify-content:space-between">
  <span>tish.kg</span><span>${page}</span></div>`

/** Лента 1080×1350. */
const feed = ({ rubric, page, body, bg }) => doc(1080, 1350, `${head(rubric, 84)}${body}${foot(page)}`, bg)
/** Сторис и обложка рилса 1080×1920: верх ~250 px и низ ~340 px перекрывает интерфейс Instagram. */
const story = ({ rubric, body, bare = false }) => doc(1080, 1920, `${bare ? '' : head(rubric, 262)}${body}`)
const pageOf = (n, total) => `${n} / ${total}`

// ---------- макеты интерфейса (вымышленные данные) ----------
const ui = {
  card: (inner, w = 888) => `<div style="width:${w}px;background:#fff;border:2px solid ${C.line};border-radius:28px;box-shadow:0 2px 4px rgba(15,42,48,.04),0 18px 40px rgba(15,42,48,.07);overflow:hidden">${inner}</div>`,
  head: (title, sub = '') => `<div style="padding:24px 32px;display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid ${C.line}"><span style="font:600 30px G;color:${C.ink}">${title}</span><span style="font:400 22px T;color:${C.muted}">${sub}</span></div>`,
  row: (a, b, chip, accent = false) => `<div style="display:flex;align-items:center;gap:22px;padding:18px 32px;border-bottom:2px solid ${C.line}">
    <span style="font:500 26px T;color:${C.ink};min-width:92px">${a}</span><span style="flex:1;font:400 25px/1.3 T;color:${C.text}">${b}</span>
    ${chip ? `<span style="font:500 21px T;background:${accent ? C.tint : C.sunk};color:${accent ? C.teal : C.text};padding:7px 16px;border-radius:8px;white-space:nowrap">${chip}</span>` : ''}</div>`,
  bubble: (text, mine = false) => `<div style="max-width:76%;margin:14px ${mine ? '28px 14px auto' : 'auto 14px 28px'};background:${mine ? C.tint : C.sunk};border-radius:20px;padding:16px 22px;font:400 24px/1.35 T;color:${C.ink}">${text}</div>`,
  buttons: (list) => `<div style="display:grid;grid-template-columns:repeat(${Math.min(list.length, 3)},1fr);gap:10px;margin:8px 28px 22px">${list.map((x) => `<span style="text-align:center;border:2px solid ${C.line};color:${C.teal};border-radius:12px;padding:12px 6px;font:500 23px T">${x}</span>`).join('')}</div>`,
  total: (label, sum) => `<div style="display:flex;justify-content:space-between;padding:22px 32px;font:600 28px G;color:${C.ink}"><span>${label}</span><span>${sum}</span></div>`,
}
const MOCK = {
  booking: ui.card(ui.head('Запись к стоматологу', 'бот в Telegram') + ui.bubble('Выберите время на четверг, 14 ноября') + ui.buttons(['10:00', '11:30', '15:00']) + ui.bubble('Четверг, 11:30 · осмотр', true) + ui.bubble('Готово! Врач подтвердит запись.')),
  reminder: ui.card(ui.head('Напоминание', 'накануне и за 2 часа') + ui.bubble('Здравствуйте! Завтра в 10:00 у вас приём у стоматолога.') + ui.buttons(['Приду', 'Нужно перенести']) + ui.bubble('Приду', true)),
  schedule: ui.card(ui.head('Сегодня, 12 ноября', '3 врача') + [
    ['09:00', 'Айгерим К. · осмотр', 'придёт', true], ['10:30', 'Бакыт С. · чистка', 'ждём ответа'],
    ['12:00', 'Свободно до 13:30', '＋ записать', true], ['15:30', 'Тимур А. · консультация', 'придёт', true]].map((r) => ui.row(...r)).join('')),
  today: ui.card(ui.head('Сегодня', 'вторник') + `<div style="display:flex;flex-wrap:wrap;gap:14px;padding:26px 32px">${[['2', 'новые заявки'], ['1', 'ждёт ответа'], ['3', 'свободных окна'], ['14', 'приёмов']].map(([n, t]) =>
    `<span style="display:flex;align-items:baseline;gap:12px;background:${C.sunk};border-radius:12px;padding:14px 20px"><b style="font:600 34px G;color:${C.ink}">${n}</b><span style="font:400 23px T;color:${C.text}">${t}</span></span>`).join('')}</div>`
    + ui.row('Врач 1', 'свободно 14:00–15:30', '＋ ближайшее', true)),
  debts: ui.card(ui.head('Должники', 'по семьям') + [['Асановы', 'семья · 3 человека', '4 500 сом'], ['Бекова Н.', 'лечение · 2 визита', '2 000 сом'], ['Орозовы', 'семья · 2 человека', '1 800 сом']].map((r) => ui.row(...r)).join('')
    + `<div style="padding:18px 32px 24px"><span style="display:inline-block;background:${C.teal};color:#fff;font:500 24px T;padding:14px 26px;border-radius:12px">Оплатить за семью</span></div>`),
  salary: ui.card(ui.head('Зарплата · ноябрь', 'оклад + %') + [['Врач 1', 'оклад + 30% от выручки', '96 400 сом'], ['Врач 2', 'оклад + 25% от выручки', '71 250 сом'], ['Ассистент', '10% от выручки врачей', '24 800 сом']].map((r) => ui.row(...r)).join('')
    + ui.total('К выплате', '192 450 сом')),
  stock: ui.card(ui.head('Что обычно уходит', 'пломба, 1 поверхность') + [['1 шт.', 'Анестетик, карпула', 'на складе 24'], ['1 пара', 'Перчатки', 'на складе 180'], ['0,3 г', 'Композит A2', 'заканчивается', true]].map((r) => ui.row(...r)).join('')
    + `<div style="padding:18px 32px 24px"><span style="display:inline-block;background:${C.teal};color:#fff;font:500 24px T;padding:14px 26px;border-radius:12px">Списать всё</span></div>`),
  promo: ui.card(ui.head('Промокоды', 'ноябрь') + [['SMILE', 'пост у блогера', '18 записей', true], ['DOOR', 'листовка у дома', '6 записей'], ['', 'новых пациентов по кодам', '11', true]].map((r) => ui.row(...r)).join('')),
  help: ui.card(ui.head('Помощь', 'помощник Tish') + ui.bubble('Как поставить врачу процент от выручки?', true) + ui.bubble('«Касса → Зарплата»: выберите врача и задайте оклад и процент. Пример расчёта появится сразу.')),
}
const phone = (inner) => `<div style="width:360px;height:740px;border-radius:56px;background:${C.ink};padding:14px;box-shadow:0 30px 60px rgba(15,42,48,.18)">
  <div style="width:100%;height:100%;border-radius:44px;background:#fff;overflow:hidden">${inner}</div></div>`
const PHONE_DAY = phone(`<div style="padding:46px 26px 18px;border-bottom:2px solid ${C.line}"><div style="font:400 20px T;color:${C.muted}">Расписание</div><div style="font:600 32px G;color:${C.ink}">Сегодня</div></div>
  ${[['09:00', 'Айгерим К.', 'осмотр'], ['10:30', 'Бакыт С.', 'чистка'], ['12:00', 'Элина М.', 'лечение'], ['14:00', 'Свободно', ''], ['15:30', 'Тимур А.', 'консультация'], ['16:30', 'Нурлан Б.', 'осмотр']].map(([t, n, s]) =>
    `<div style="display:flex;gap:16px;padding:17px 24px;border-bottom:2px solid ${C.line}"><span style="font:500 23px T;color:${C.ink};width:70px">${t}</span><span style="font:400 22px/1.3 T;color:${n === 'Свободно' ? C.teal : C.ink}">${n}<br><span style="color:${C.muted}">${s}</span></span></div>`).join('')}`)

// ---------- шаблоны ленты ----------
const T = {
  /** Обложка: заголовок, черта, подзаголовок; иконка, Тишка или ничего. */
  cover: (p) => feed({ rubric: p.rubric, page: 'листайте →', body: `
    ${fit('bot h', 'top:220px;left:96px;right:96px;height:560px', p.title, 112)}
    <div class="a rule" style="top:830px;left:96px"></div>
    ${fit('top p', `top:880px;left:96px;width:600px;height:300px;color:${C.text}`, p.sub, 40)}
    ${p.mascot ? `<div class="a" style="right:96px;top:920px">${tishka(150)}</div>` : p.icon ? `<div class="a" style="right:96px;top:930px">${icon(p.icon, 200, C.teal, 1.6)}</div>` : ''}` }),

  /** Шаг карусели: номер, иконка, заголовок, текст и (по желанию) подсказка в плашке. */
  step: (p) => feed({ rubric: p.rubric, page: pageOf(p.n + 1, p.total), body: `
    <div class="a h" style="top:200px;left:96px;font-size:150px;color:${C.teal};letter-spacing:-.04em;font-weight:500">${String(p.n).padStart(2, '0')}</div>
    <div class="a" style="top:236px;right:96px">${icon(p.icon ?? 'tooth', 120, C.teal, 1.6)}</div>
    ${fit('bot h', 'top:400px;left:96px;right:96px;height:250px', p.title, 80)}
    ${fit('top p', `top:710px;left:96px;right:96px;height:${p.tip ? 270 : 440}px;color:${C.text}`, p.text, 42)}
    ${p.tip ? `<div class="a" style="top:1010px;left:96px;right:96px;height:170px;border-radius:24px;background:${C.tint}"></div>
      ${fit('mid p', `top:1010px;left:132px;right:132px;height:170px;color:${C.ink}`, `<span style="color:${C.teal};font-weight:500">Совет:</span> ${p.tip}`, 34)}` : ''}` }),

  /** Последний слайд: вывод и призыв. */
  final: (p) => feed({ rubric: p.rubric, page: p.total ? pageOf(p.total, p.total) : '', body: `
    ${fit('bot h', 'top:220px;left:96px;right:96px;height:440px', p.title, 100)}
    <div class="a rule" style="top:710px;left:96px"></div>
    ${fit('top p', `top:760px;left:96px;right:96px;height:200px;color:${C.text}`, p.text, 42)}
    ${fit('top', 'top:990px;left:96px;right:96px;height:120px', `<span class="pill" style="background:${C.teal};color:#fff;font-size:1em">${p.cta}</span>`, 34)}
    <div class="a small" style="top:1150px;left:96px">${p.disclaimer === false ? '' : DISCLAIMER}</div>` }),

  /** Фраза с юмором крупно + «а если серьёзно». */
  quote: (p) => feed({ rubric: p.rubric ?? 'Юмор', page: p.total ? pageOf(p.n + 1, p.total) : '', body: `
    <div class="a h" style="top:170px;left:90px;font-size:220px;line-height:1;font-weight:500;color:${C.teal}">«</div>
    ${fit('mid h', 'top:400px;left:96px;right:96px;height:500px', p.line, 92)}
    <div class="a rule" style="top:950px;left:96px"></div>
    <div class="a" style="top:985px;left:96px;font:500 28px T;color:${C.teal}">А если серьёзно</div>
    ${fit('top p', `top:1035px;left:96px;right:${p.mascot ? 300 : 96}px;height:160px;color:${C.text}`, p.fact, 34)}
    ${p.mascot ? `<div class="a" style="right:96px;top:1010px">${tishka(110)}</div>` : ''}` }),

  /** «Миф или правда»: вердикт, утверждение, объяснение. */
  myth: (p) => {
    const ok = p.verdict === 'Правда'
    const chipStyle = p.verdict === 'Миф' ? `background:${C.ink};color:#fff` : ok ? `background:${C.teal};color:#fff` : `border:3px solid ${C.teal};color:${C.teal};padding:17px 37px`
    return feed({ rubric: 'Миф или правда', page: p.total ? pageOf(p.n + 1, p.total) : '', body: `
    <div class="a" style="top:220px;left:96px"><span class="pill" style="${chipStyle};font:600 40px G">${p.verdict}</span></div>
    ${fit('top h', 'top:350px;left:96px;right:96px;height:420px', `«${p.statement}»`, 86)}
    <div class="a rule" style="top:820px;left:96px"></div>
    ${fit('top p', `top:870px;left:96px;right:96px;height:270px;color:${C.text}`, p.explain, 40)}
    <div class="a small" style="top:1160px;left:96px">${DISCLAIMER}</div>` })
  },

  // ---------- для клиник ----------
  b2bCover: (p) => feed({ rubric: 'Для клиник', page: 'листайте →', body: `
    ${fit('top h', 'top:230px;left:96px;width:520px;height:560px', p.title, 92)}
    <div class="a rule" style="top:840px;left:96px"></div>
    ${fit('top p', `top:890px;left:96px;width:500px;height:300px;color:${C.text}`, p.sub, 38)}
    <div class="a" style="top:220px;right:96px">${PHONE_DAY}</div>
    <div class="a small" style="top:985px;right:96px;width:360px;text-align:center">данные — вымышленные</div>` }),

  /** Шаг «было → с Tish» с макетом экрана. */
  b2bStep: (p) => feed({ rubric: 'Для клиник', page: pageOf(p.n + 1, p.total), body: `
    <div class="a h" style="top:190px;left:96px;font-size:44px;color:${C.teal};font-weight:500">${String(p.n).padStart(2, '0')}</div>
    ${fit('top h', 'top:250px;left:96px;right:96px;height:160px', p.title, 70)}
    <div class="a" style="top:440px;left:96px;width:150px;font:500 26px T;color:${C.muted}">Было</div>
    ${fit('top p', `top:436px;left:246px;right:96px;height:80px;color:${C.muted}`, p.was, 32)}
    <div class="a" style="top:540px;left:96px;width:150px;font:500 26px T;color:${C.teal}">С Tish</div>
    ${fit('top p', `top:536px;left:246px;right:96px;height:160px;color:${C.ink}`, p.now, 32)}
    <div class="a" style="top:730px;left:96px">${MOCK[p.mock]}</div>` }),

  /** Одиночный пост для клиник: заголовок, текст, макет. */
  b2bMock: (p) => feed({ rubric: 'Для клиник', body: `
    ${fit('bot h', 'top:200px;left:96px;right:96px;height:260px', p.title, 88)}
    ${fit('top p', `top:490px;left:96px;right:96px;height:200px;color:${C.text}`, p.text, 38)}
    <div class="a" style="top:720px;left:96px">${MOCK[p.mock]}</div>` }),

  /** Пост-приглашение: пункты с галочками и кнопка. */
  b2bPoints: (p) => feed({ rubric: 'Для клиник', body: `
    <div class="a" style="top:210px;left:96px"><span class="pill" style="border:2px solid ${C.line};color:${C.teal};font:500 28px T;padding:12px 26px">${p.badge}</span></div>
    ${fit('top h', 'top:310px;left:96px;right:96px;height:250px', p.title, 96)}
    ${fit('top p', `top:600px;left:96px;right:96px;height:420px;color:${C.ink}`, p.points.map((x) => `<div style="display:flex;gap:24px;margin-bottom:28px"><span style="flex:none;margin-top:4px">${icon('check', 44, C.teal, 3)}</span><span>${x}</span></div>`).join(''), 40)}
    <div class="a" style="top:1060px;left:96px"><span class="pill" style="background:${C.teal};color:#fff">${p.cta}</span></div>` }),

  // ---------- сторис 1080×1920 ----------
  /** Вопрос: заголовок и пунктирное место под стикер. */
  storyQ: (p) => story({ rubric: p.rubric, body: `
    ${fit('bot h', 'top:400px;left:96px;right:96px;height:480px', p.title, 104)}
    <div class="a" style="top:950px;left:120px;right:120px;height:380px;border-radius:40px;border:3px dashed #CCD8D8"></div>
    <div class="a" style="top:1395px;left:96px">${icon(p.icon ?? 'question', 72, C.teal, 2)}</div>
    ${fit('mid p', `top:1380px;left:200px;right:96px;height:110px;color:${C.muted}`, p.hint, 36)}` }),

  /** Ответ: вердикт акцентом, пояснение. */
  storyA: (p) => story({ rubric: p.rubric ?? 'Ответ', body: `
    ${fit('bot h', `top:420px;left:96px;right:96px;height:440px;color:${C.teal}`, p.answer, 128)}
    <div class="a rule" style="top:910px;left:96px"></div>
    ${fit('top p', `top:960px;left:96px;right:96px;height:440px;color:${C.ink}`, p.text, 50)}
    <div class="a small" style="top:1460px;left:96px;font-size:28px">${p.foot ?? DISCLAIMER}</div>` }),

  /** Факт: крупное число или слово, заголовок, текст. */
  storyFact: (p) => story({ rubric: p.rubric ?? 'Факт дня', body: `
    ${fit('bot h', `top:380px;left:96px;right:96px;height:340px;color:${C.teal};font-weight:500`, p.big, 220)}
    ${fit('top h', 'top:790px;left:96px;right:96px;height:280px', p.title, 80)}
    <div class="a rule" style="top:1100px;left:96px"></div>
    ${fit('top p', `top:1150px;left:96px;right:96px;height:300px;color:${C.text}`, p.text, 44)}` }),

  /** Знакомство: небольшой Тишка, заголовок, текст. */
  storyIntro: (p) => story({ rubric: p.rubric, body: `
    <div class="a" style="top:420px;left:96px">${tishka(170)}</div>
    ${fit('top h', 'top:740px;left:96px;right:96px;height:420px', p.title, 104)}
    <div class="a rule" style="top:1190px;left:96px"></div>
    ${fit('top p', `top:1240px;left:96px;right:96px;height:250px;color:${C.text}`, p.text, 46)}` }),

  /** Спокойная сторис: только текст по центру, без рубрики и логотипа. */
  storyCalm: (p) => story({ bare: true, body: `
    ${fit('mid h', 'top:620px;left:110px;right:110px;height:440px;text-align:center', p.title, 76)}
    <div class="a" style="top:1100px;left:510px;width:60px;height:3px;background:${C.muted}"></div>
    ${fit('top p', `top:1140px;left:130px;right:130px;height:280px;text-align:center;color:${C.text}`, p.text, 42)}` }),

  /** Обложка рилса: важное — в средней полосе 1080×1440 (сетка профиля режет до 3:4). */
  reels: (p) => story({ bare: true, body: `
    <div class="a" style="top:300px;left:0;right:0;display:flex;justify-content:center"><div class="rub"><b></b>Reels · ${p.rubric}</div></div>
    ${fit('mid h', 'top:380px;left:110px;right:110px;height:560px;text-align:center', p.title, 116)}
    <div class="a" style="top:1000px;left:0;right:0;display:flex;justify-content:center;align-items:center;height:400px">${p.mascot ? tishka(220)
      : p.big ? `<div class="h" style="font-size:240px;color:${C.teal};font-weight:500">${p.big}</div>` : icon(p.icon, 260, C.teal, 1.4)}</div>
    <div class="a" style="top:1460px;left:0;right:0;text-align:center"><span class="pill" style="border:2px solid ${C.line};color:${C.ink}">${p.chip}</span></div>
    <div class="a" style="top:1590px;left:0;right:0;display:flex;justify-content:center"><div class="brand"><img src="${LOGO}" alt="">Tish</div></div>` }),
}

/** Карусель: обложка + слайды (номер n и всего total) + финал. */
const expand = (item) => {
  if (!item.carousel) return item.slides
  const { cover, steps, final } = item.carousel
  const total = steps.length + 2
  return [cover, ...steps.map((s, i) => ({ ...s, n: i + 1, total })), { ...final, total }]
}

// ---------- рендер ----------
fs.mkdirSync(OUT, { recursive: true })
for (const f of fs.readdirSync(OUT)) {
  if (/^\d{4}-\d{2}-\d{2}-.+\.png$/.test(f)) fs.unlinkSync(path.join(OUT, f))
}
const browser = await chromium.launch()
const pg = await (await browser.newContext({ deviceScaleFactor: 1 })).newPage()
const files = []
const plan = []
let mascots = 0
for (const item of [...PLAN].sort((a, b) => a.date.localeCompare(b.date))) {
  const slides = expand(item)
  const images = []
  for (const [i, s] of slides.entries()) {
    const html = T[s.t](s)
    if (html.includes(TISHKA)) mascots++
    const tall = html.includes('height:1920px')
    await pg.setViewportSize({ width: 1080, height: tall ? 1920 : 1350 })
    await pg.setContent(html)
    await pg.evaluate(() => document.fonts.ready)
    // Ужать шрифт, пока текст не влезет в свою рамку
    const bad = await pg.evaluate(() => {
      const left = []
      for (const o of document.querySelectorAll('.fit')) {
        const inner = o.firstElementChild
        let size = parseFloat(getComputedStyle(o).fontSize)
        const over = () => inner.scrollWidth > o.clientWidth + 1 || inner.offsetHeight > o.clientHeight + 1
        while (over() && size > 20) { size -= 2; o.style.fontSize = `${size}px` }
        if (over()) left.push(inner.textContent.slice(0, 40))
      }
      return left
    })
    if (bad.length) console.warn(`! не влезло в ${item.slug}-${i + 1}:`, bad)
    const name = slides.length > 1 ? `${item.date}-${item.slug}-${i + 1}.png` : `${item.date}-${item.slug}.png`
    await pg.screenshot({ path: path.join(OUT, name) })
    files.push(path.join(OUT, name))
    images.push(`/content/${name}`)
  }
  plan.push({ date: item.date, kind: item.kind, title: item.title, caption: item.caption ?? '', images, note: item.note ?? '' })
}
await browser.close()
fs.writeFileSync(path.join(OUT, 'plan.json'), `${JSON.stringify(plan, null, 2)}\n`)

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
console.log(`Готово: ${plan.length} единиц плана, ${files.length} картинок (Тишка — на ${mascots}), ${(total / 1024 / 1024).toFixed(1)} МБ → ${OUT}`)
