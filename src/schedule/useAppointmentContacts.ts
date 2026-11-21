import { useQuery } from '@tanstack/react-query'

import { api, unwrap, type Schemas } from '../api/client'
import { contactPhone } from '../lib/guardian'
import { openLink, telegram } from '../lib/telegram'
import { agoText, smsUrl } from '../lib/texts'
import { somText, timeOf } from '../lib/time'
import { isMobile } from '../pwa/pwa'
import { useBotInvite } from './useBotInvite'
import { talkItems, type ContactItem } from './contactItems'
import { confirmRemind, isRepeat, remindedText } from './remindAgain'
import { asksReview, useSendReview } from './reviewLinks'
import { useRemind } from './useRemind'

type Appointment = Schemas['AppointmentView']

/**
 * Пункты «📞 Связаться ▾» в карточке приёма — по тем же условиям и с той же логикой, что раньше у отдельных кнопок:
 * - «Связаться»: позвонить; WhatsApp пустым чатом — кроме заявки (её подтверждают звонком) и приёма коллеги;
 * - «Напомнить о приёме» — у запланированного, пока он не прошёл: в бот (пациент в Telegram), WhatsApp с готовым
 *   текстом, на телефоне — SMS; повтор — после вопроса и другим текстом (confirmRemind), отметка «напомнили»;
 * - «Попросить оценку» — после приёма у пациента без Telegram (asksReview), не чаще, чем разрешает сервер:
 *   просили недавно — серый пункт с его объяснением; когда просили — мелко под пунктом;
 * - «Напомнить о долге» — у пациента долг и вы видите долги: та же форма, что в «Должниках» (onDebt);
 * - «📲 Пригласить в Telegram-бот» — пациенту без бота, с номером, не у заявки (invite: карточка приёма рендерит окно `inviteSheet`).
 */
export function useAppointmentContacts(a: Appointment, { canEdit, debtSom, onDebt, invite = false }: {
  canEdit: boolean; debtSom: number; onDebt?: () => void
  /** Пункт «Пригласить в бот» — там, где рендерят окно `inviteSheet` (карточка приёма; не меню быстрых действий) */
  invite?: boolean
}) {
  const remind = useRemind(a)
  // Пригласить в бот — как WhatsApp: не у заявки (её подтверждают звонком) и есть куда отправить; без номера — из карточки пациента
  const botInvite = useBotInvite(invite && canEdit && a.status !== 'REQUESTED' && contactPhone(a.patient) ? a.patient : null)
  const phone = contactPhone(a.patient)
  const canRemind = canEdit && a.status === 'SCHEDULED' && a.endAt != null && new Date(a.endAt) > new Date()
  const wantsReview = canEdit && asksReview(a)
  const review = useQuery({
    queryKey: ['review-link', a.id],
    queryFn: () => unwrap(api.GET('/api/appointments/{id}/review-link', { params: { path: { id: a.id } } })),
    retry: false,
    enabled: wantsReview,
  })
  const sendReview = useSendReview()
  const asks = isRepeat(a)
  const lastReminded = a.reminderOpenedAt ?? a.soonRemindedAt
  const reminded = lastReminded
    ? `уже напоминали ${remindedText(lastReminded)}${a.soonRemindedAt && !a.reminderOpenedAt ? ' (бот, за 2 часа)' : ''}${a.reply === 'CONFIRMED' ? ', ответил «Приду»' : ''}`
    : a.reply === 'CONFIRMED' ? 'пациент уже ответил «Приду»' : undefined
  const sms = (to: string) => {
    const body = remind.text ?? ''
    remind.opened.mutate()
    // В Telegram ссылка sms: молчит — своя страница в браузере телефона откроет «Сообщения»
    if (telegram()) openLink(`${window.location.origin}/call.html#${new URLSearchParams({ sms: to, body })}`)
    else window.location.href = smsUrl(to, body)
  }
  const items: ContactItem[] = [...talkItems(a.patient, { whatsapp: canEdit && a.status !== 'REQUESTED' })]
  if (canRemind && a.patient.telegram) {
    items.push({ label: 'Напомнить о приёме в Telegram', group: 'send', icon: 'telegram', hint: reminded, disabled: remind.action.isPending,
      onSelect: () => void confirmRemind(a).then((ok) => ok && remind.telegram()) })
  }
  if (canRemind && phone) {
    items.push({ label: 'Напомнить о приёме в WhatsApp', group: 'send', icon: 'whatsapp', hint: reminded, disabled: remind.text == null || remind.opened.isPending,
      // Первое напоминание — сразу, чтобы WhatsApp открылся по нажатию; повтор — после вопроса
      onSelect: () => { if (asks) void confirmRemind(a).then((ok) => ok && remind.whatsapp()); else remind.whatsapp() } })
    // На компьютере SMS не отправить
    // Ссылкой sms:, а не из скрипта: так «Сообщения» открываются надёжнее
    if (isMobile() && remind.text != null) {
      items.push({ label: 'Напомнить о приёме по SMS', group: 'send', icon: 'sms', hint: reminded, href: smsUrl(phone, remind.text),
        onSelect: (e) => {
          if (asks) {
            // Повтор: сначала вопрос, потом «Сообщения» сами
            e?.preventDefault()
            void confirmRemind(a).then((ok) => ok && sms(phone))
            return
          }
          remind.opened.mutate()
          if (!telegram()) return
          e?.preventDefault()
          openLink(`${window.location.origin}/call.html#${new URLSearchParams({ sms: phone, body: remind.text ?? '' })}`)
        } })
    }
  }
  const d = review.data
  if (wantsReview && d?.available) {
    items.push({ label: d.askedAt ? 'Попросить оценку ещё раз' : 'Попросить оценку', group: 'send', icon: 'star', disabled: sendReview.isPending,
      hint: d.askedAt ? `попросили ${agoText(d.askedAt)}, в ${timeOf(d.askedAt)}` : 'ссылка на оценку в WhatsApp',
      onSelect: () => sendReview.mutate(a.id) })
  } else if (wantsReview && d?.reason === 'recent') {
    items.push({ label: 'Попросить оценку', group: 'send', icon: 'star', disabled: true, hint: d.message, onSelect: () => {} })
  }
  if (onDebt && debtSom > 0) {
    items.push({ label: 'Напомнить о долге', group: 'send', icon: 'debt', hint: `долг ${somText(debtSom)}`, onSelect: onDebt })
  }
  if (botInvite.item) items.push(botInvite.item)
  // «Напомнить» — главной кнопкой карточки у записи на будущий день (бот, иначе WhatsApp); те же действия, что в меню
  const remindMain = canRemind && a.patient.telegram
    ? { label: 'Напомнить в Telegram', disabled: remind.action.isPending, run: () => void confirmRemind(a).then((ok) => ok && remind.telegram()) }
    : canRemind && phone
      ? { label: 'Напомнить в WhatsApp', disabled: remind.text == null || remind.opened.isPending,
          run: () => { if (asks) void confirmRemind(a).then((ok) => ok && remind.whatsapp()); else remind.whatsapp() } }
      : null
  return { items, remindMain, inviteSheet: botInvite.sheet, error: remind.action.error ?? remind.opened.error ?? sendReview.error, nowhere: canRemind && remind.nowhere }
}
