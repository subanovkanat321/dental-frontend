import type { ReactNode } from 'react'

import { P } from './subIconPaths'

/**
 * Иконки пунктов меню действий (`ActionMenu`, «⋯» карточек, меню на записи, «Связаться», 2026-11-20): тот же набор
 * линий 24×24, что у подразделов, — вместо «＋» и разных эмодзи. Ключ — в `ActionItem.icon`; оттенок — `--ico-*` по
 * смыслу (MENU_TONES), у опасных пунктов — красный, как подпись.
 */
const M = {
  phone: <path d="M5 4h3.5l1.5 4-2 1.5a11 11 0 0 0 6.5 6.5L16 14l4 1.5V19a1.5 1.5 0 0 1-1.6 1.5C10.5 20 4 13.5 3.5 5.6A1.5 1.5 0 0 1 5 4z" />,
  whatsapp: <><path d="M4 20l1.3-4A8 8 0 1 1 8.6 19z" /><path d="M9.2 8.6c.3-.6.8-.6 1-.2l.7 1.5c.1.3 0 .6-.3.9l-.4.4c.6 1.2 1.6 2.2 2.8 2.8l.4-.4c.3-.3.6-.4.9-.3l1.5.7c.4.2.4.7-.2 1-1 .6-2.3.5-3.6-.3a8.5 8.5 0 0 1-3-3c-.8-1.3-.9-2.6-.3-3.6z" /></>,
  sms: <><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v10a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3.5V17A1.5 1.5 0 0 1 4 15.5z" /><path d="M8 9h8M8 12.5h5" /></>,
  move: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4M10 15.5h6M14 13l2.5 2.5L14 18" /></>,
  repeat: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4M12 13v6M9 16h6" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4.5 21c.9-4 3.8-6 7.5-6s6.6 2 7.5 6" /></>,
  record: <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 2.5h6v3H9zM9 11h6M9 15h4" /></>,
  pay: <><rect x="2.5" y="5" width="19" height="14" rx="2" /><path d="M2.5 10h19M6 15h4" /></>,
  trash: <><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></>,
  cancel: <><circle cx="12" cy="12" r="9" /><path d="M9 9l6 6M15 9l-6 6" /></>,
  noshow: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5 1.3 0 2.5.3 3.5 1M16 15l5 5M21 15l-5 5" /></>,
  print: <><path d="M7 9V3h10v6" /><rect x="3" y="9" width="18" height="8" rx="2" /><path d="M7 14h10v7H7z" /></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /></>,
  show: <><path d="M3 5.5A1.5 1.5 0 0 1 4.5 4H10a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H3z" /><path d="M21 5.5A1.5 1.5 0 0 0 19.5 4H14a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h7z" /></>,
  edit: <><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z" /><path d="M14.5 7.5l2 2" /></>,
  ai: P.sparkles,
  star: P.star,
  debt: P.debtor,
  task: P.checkList,
  lab: P.tooth,
  contract: P.signDoc,
  memo: P.note,
  send: P.send,
  telegram: P.plane,
  tag: P.tag,
  bell: P.bell,
  chair: P.chair,
  clock: P.clock,
  doc: P.doc,
} as const

export type MenuIconName = keyof typeof M
export const MENU_ICONS: Record<MenuIconName, ReactNode> = M

