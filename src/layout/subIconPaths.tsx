import type { ReactNode } from 'react'

import type { Page } from '../lib/route'

/**
 * Иконки подразделов (2026-11-13): тот же рисунок, что у иконок разделов (`Icon.tsx`) — линии 24×24,
 * stroke = currentColor, 1.8. Показываем в списках подразделов (лист снизу, лист «Ещё» → раздел, панель у
 * меню компьютера, «⌄» у вкладок); в самой полосе вкладок — только текст, там тесно. Цвет — оттенок своего
 * раздела (`--ico-<раздел>`), у выбранного — `--accent-ink` (crm.css, DESIGN.md → Colors).
 */
const P = {
  list: <><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1" /><circle cx="4.5" cy="12" r="1" /><circle cx="4.5" cy="18" r="1" /></>,
  calendarCheck: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4M9 15.5l2 2 4-4" /></>,
  hourglass: <path d="M6 3h12M6 21h12M8 3v2.5c0 2 4 4.5 4 6.5s-4 4.5-4 6.5V21M16 3v2.5c0 2-4 4.5-4 6.5s4 4.5 4 6.5V21" />,
  comeback: <><path d="M21 12a9 9 0 1 1-2.6-6.4L21 8" /><path d="M21 3v5h-5" /></>,
  tooth: <path d="M7 3.5c-2 0-3.5 1.6-3.5 4 0 3 1.2 4.6 1.8 7.2.5 2.4.9 5.8 2.4 5.8 1.4 0 1.6-3.4 2.4-5.2.4-.9 1.4-.9 1.8 0 .8 1.8 1 5.2 2.4 5.2 1.5 0 1.9-3.4 2.4-5.8.6-2.6 1.8-4.2 1.8-7.2 0-2.4-1.5-4-3.5-4-1.6 0-2.4 1-5 1s-3.4-1-5-1z" />,
  chat: <><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v10a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3.5V17A1.5 1.5 0 0 1 4 15.5z" /><path d="M8.5 10.5h.01M12 10.5h.01M15.5 10.5h.01" /></>,
  banknote: <><rect x="2.5" y="6" width="19" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 12h.01M18 12h.01" /></>,
  wallet: <><path d="M19 7V5.5A1.5 1.5 0 0 0 17.5 4H5.5a2 2 0 0 0 0 4H19a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5.5a2 2 0 0 1-2-2V6" /><path d="M16 14h.01" /></>,
  trend: <><path d="M3 3v18h18" /><path d="M7 15l4-4 3 3 6-7" /></>,
  receipt: <><path d="M5 3h14v18l-2.5-1.5L14 21l-2-1.5-2 1.5-2.5-1.5L5 21z" /><path d="M9 8h6M9 12h6M9 16h3" /></>,
  debtor: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5" /><path d="M19.5 5v6M19.5 15h.01" /></>,
  envelope: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></>,
  bars: <path d="M4 20h16M7 16v-5M12 16V6M17 16V9" />,
  doc: <><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></>,
  box: <><path d="M3 8l2-4h14l2 4" /><path d="M3 8h18v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" /><path d="M10 12h4" /></>,
  cart: <><circle cx="9" cy="20" r="1.3" /><circle cx="18" cy="20" r="1.3" /><path d="M2.5 3.5H5l2.4 11.2a1.5 1.5 0 0 0 1.5 1.3h8.4a1.5 1.5 0 0 0 1.5-1.2L20.5 8H6" /></>,
  buildings: <><path d="M3 21h18M5 21V11h5v10M10 21V4h9v17" /><path d="M13 8h3M13 12h3M13 16h3" /></>,
  clinic: <><path d="M4 21V8l8-5 8 5v13" /><path d="M12 9v6M9 12h6M9 21v-3h6v3" /></>,
  coins: <><ellipse cx="9" cy="6.5" rx="6" ry="2.5" /><path d="M3 6.5v4c0 1.4 2.7 2.5 6 2.5M3 10.5v4c0 1.4 2.7 2.5 6 2.5" /><circle cx="16.5" cy="15.5" r="4.5" /></>,
  clipCheck: <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 2.5h6v3H9zM9 13l2 2 4-4" /></>,
  clipList: <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 2.5h6v3H9zM9 11h6M9 15h4" /></>,
  inbox: <><path d="M3 13h5l1.5 3h5l1.5-3h5" /><path d="M5.5 5h13L21 13v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6z" /></>,
  send: <path d="M21 3L10 14M21 3l-7 18-4-7-7-4z" />,
  megaphone: <><path d="M3 10v4a1 1 0 0 0 1 1h3l6 4V5L7 9H4a1 1 0 0 0-1 1z" /><path d="M17 9a4 4 0 0 1 0 6M19.5 6.5a7.5 7.5 0 0 1 0 11" /></>,
  signDoc: <><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" /><path d="M14 3v5h5M8 17c1.5-2 2.5-2 3 0 .4 1.4 1.3 1.4 2.5 0M15.5 17H17" /></>,
  checkDoc: <><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" /><path d="M14 3v5h5M9 15l2 2 4-4" /></>,
  layers: <path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5" />,
  image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="M21 16l-5-5-9 9" /></>,
  sparkles: <path d="M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.7 1.8 1.8.7-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7z" />,
  pulse: <path d="M3 12h4l2-5 4 10 2-5h6" />,
  sliders: <><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></>,
  people: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c1.9.8 3.1 2.4 3.5 5.2" /></>,
  tag: <><path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" /><circle cx="7.5" cy="7.5" r="1.5" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  chair: <path d="M7 3v10h10M8 13l-1 7M16 13l1 7M7 9h7a2 2 0 0 1 2 2v2" />,
  bell: <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0" />,
  note: <><path d="M4 4h16v10l-6 6H4z" /><path d="M14 20v-6h6M8 9h8" /></>,
  news: <><path d="M4 5h13v14a2 2 0 0 0 2 2H6a2 2 0 0 1-2-2z" /><path d="M17 9h3v10a2 2 0 0 1-2 2M8 9h5M8 13h5M8 17h3" /></>,
  card: <><rect x="2.5" y="5" width="19" height="14" rx="2" /><path d="M2.5 10h19M6 15h4" /></>,
  database: <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></>,
} as const

/** Рисунок каждого подраздела: раздел → ключ подраздела (как в `subsOf`). Новый подраздел — сюда же (тест `subIcons.test`). */
export const SUB_ICONS: Partial<Record<Page, Record<string, ReactNode>>> = {
  patients: { all: P.list, booked: P.calendarCheck, waitlist: P.hourglass, comeback: P.comeback, recall: P.tooth, questions: P.chat },
  cash: { money: P.banknote, earnings: P.wallet, analytics: P.trend, expenses: P.receipt, debtors: P.debtor, salary: P.envelope, stats: P.bars, report: P.doc },
  stock: { materials: P.box, spending: P.cart },
  platform: {
    clinics: P.buildings, analytics: P.trend, finance: P.coins, surveys: P.clipCheck, tickets: P.inbox, outreach: P.send, broadcast: P.megaphone,
    agreements: P.signDoc, tariffs: P.layers, content: P.image, materials: P.box, ai: P.sparkles, health: P.pulse, settings: P.sliders,
  },
  clinic: { about: P.clinic, staff: P.people, services: P.tag, hours: P.clock, chairs: P.chair },
  settings: {
    reminder: P.bell, questions: P.clipList, contract: P.signDoc, memos: P.note, 'patient-news': P.news, sources: P.megaphone,
    plan: P.card, agreement: P.checkDoc, data: P.database, ai: P.sparkles,
  },
}


/**
 * Свой приглушённый оттенок подраздела по смыслу (2026-11-14: «здесь, похоже, нет краски» — у «Настроек» все
 * иконки были серо-синими): токен `--ico-<имя>` из tokens.css (светлая и тёмная тема, ≥3:1). Нет в списке —
 * оттенок раздела. Разделы с ярким своим цветом (Пациенты, Касса, Склад) — одним оттенком: там он и так виден.
 */
export const SUB_TONES: Partial<Record<Page, Record<string, string>>> = {
  settings: {
    reminder: 'stock', questions: 'patients', contract: 'schedule', memos: 'memo', 'patient-news': 'platform', sources: 'instagram',
    plan: 'cash', agreement: 'settings', data: 'data', ai: 'ai',
  },
  clinic: { about: 'clinic', staff: 'patients', services: 'stock', hours: 'schedule', chairs: 'learn' },
  platform: {
    clinics: 'platform', analytics: 'patients', finance: 'finance', surveys: 'stock', tickets: 'support', outreach: 'schedule', broadcast: 'help',
    agreements: 'data', tariffs: 'cash', content: 'instagram', materials: 'appearance', ai: 'ai', health: 'logout', settings: 'settings',
  },
}
