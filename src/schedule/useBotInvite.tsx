import { useState, type ReactNode } from 'react'

import { BotInviteSheet, type InvitePatient } from './BotInvite'
import { invitedHint } from './botInvite'
import type { ContactItem } from './contactItems'

/**
 * «📲 Пригласить в Telegram-бот» в «📞 Связаться ▾» — пациенту без бота (2026-11-20). Пункт открывает окно
 * BotInviteSheet; `sheet` — само окно: его рендерит тот, кто показывает меню (карточка приёма, карточка пациента).
 * Пациент уже в боте (или карточки ещё нет) — пункта нет.
 */
export function useBotInvite(patient?: InvitePatient | null): { item: ContactItem | null; sheet: ReactNode } {
  const [open, setOpen] = useState(false)
  if (!patient?.id || patient.telegram) return { item: null, sheet: null }
  return {
    item: { label: 'Пригласить в Telegram-бот', group: 'send', icon: '📲', hint: invitedHint(patient.botInvitedAt) ?? 'напоминания — бесплатно', onSelect: () => setOpen(true) },
    sheet: open ? <BotInviteSheet patient={patient} onClose={() => setOpen(false)} /> : null,
  }
}

