import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { api, unwrap, type Schemas } from '../api/client'
import { useBack } from '../lib/back'
import { usePlatformInfo } from '../api/platform'
import { openMine } from '../lib/route'
import { openLink, telegram } from '../lib/telegram'
import { useMedia } from '../lib/useMedia'
import { TOUR_KEY, useFirstScreensBusy } from '../tour/state'
import { GROUP_TIP, TIPS, tipsFor, type Tip } from './catalog'
import { TIP_CARD_KEY, TIPS_KEY, useTipsOff, useTipsState } from './state'
import './tips.css'

type Me = Schemas['BookingViewsMe']
type TipsView = Schemas['StaffTipsTipsView']

/** Пауза перед решением: плашка профиля и окно уведомлений успеют сказать, что они на экране, — поверх них совета нет. */
const DECIDE_DELAY_MS = 900

/** Куда ведёт «Показать»: пункт «Я» / «Помощи» — новой записью с «‹ Назад», остальное — раздел или подраздел. */
function go(target: string) {
  const [page, ...rest] = target.split('/')
  if ((page === 'me' || page === 'help') && rest.length) openMine(page, rest.join('/'))
  else window.location.hash = `/${target}`
}

/**
 * «Совет дня» — окно по центру экрана (и на телефоне), закрыть — ✕, «Понятно», тап по фону, Esc или «Назад»: одна короткая подсказка не чаще раза в день на человека — на первом входе за день,
 * на любом устройстве (решает сервер: POST /api/me/tips/shown отвечает granted один раз в день). Не в день тура и
 * не до него, не поверх плашки профиля и окна уведомлений (useFirstScreensBusy), не после «Не показывать советы».
 *
 * В первые дни после тура вместо совета — приглашение в группу врачей Tish (если владелец платформы задал ссылку):
 * не больше 3 раз, раз в 3 дня, пока не нажали «Вступить» или «Не надо».
 */
export function TipOfDay({ me }: { me: Me }) {
  const staff = Boolean(me.doctor)
  const client = useQueryClient()
  const tour = useQuery({ queryKey: TOUR_KEY, queryFn: () => unwrap(api.GET('/api/me/tour')), enabled: staff, staleTime: Infinity, retry: false })
  const state = useTipsState(staff && Boolean(tour.data?.seenAt))
  const info = usePlatformInfo()
  const groupUrl = info.data?.doctorsGroupUrl
  // Ссылку на группу ждём (или ошибку): иначе в первый день вместо приглашения ушёл бы обычный совет
  const infoKnown = info.isFetched
  const busy = useFirstScreensBusy()
  const phone = useMedia('(max-width: 760px)')
  const card = useQuery({ queryKey: TIP_CARD_KEY, queryFn: () => null as string | null, enabled: false, initialData: null, staleTime: Infinity })
  // Решаем один раз за сеанс: второй запрос «показываю» в тот же день сервер всё равно отклонит
  const decided = useRef(false)
  const claim = useMutation({
    mutationFn: (tip: string) => unwrap(api.POST('/api/me/tips/shown', { body: { tip } })),
    onSuccess: (r, tip) => {
      client.setQueryData(TIPS_KEY, r.tips)
      if (r.granted) client.setQueryData(TIP_CARD_KEY, tip)
    },
  })
  const view = state.data
  const { mutate } = claim
  useEffect(() => {
    if (!view?.ready || !infoKnown || busy || decided.current || card.data) return
    const t = window.setTimeout(() => {
      const tip = choose(me, view, groupUrl, phone)
      decided.current = true
      if (tip) mutate(tip)
    }, DECIDE_DELAY_MS)
    return () => window.clearTimeout(t)
  }, [view, infoKnown, busy, card.data, me, groupUrl, phone, mutate])

  const close = () => client.setQueryData(TIP_CARD_KEY, null)
  const off = useTipsOff()
  const groupDone = useMutation({
    mutationFn: () => unwrap(api.POST('/api/me/tips/group-done')),
    onSuccess: (r) => client.setQueryData(TIPS_KEY, r),
  })
  const id = card.data
  if (!id) return null
  if (id === GROUP_TIP) {
    if (!groupUrl) return null
    return (
      <GroupInvite
        onJoin={() => { openLink(groupUrl); groupDone.mutate(); close() }}
        onDecline={() => { groupDone.mutate(); close() }}
        onClose={close} />
    )
  }
  const tip = TIPS.find((t) => t.id === id)
  if (!tip) return null
  return <TipCard tip={tip} onClose={close} onOff={() => { off.mutate(true); close() }} />
}

/** Что показать сегодня: приглашение в группу (если пора и есть ссылка), иначе первый подходящий совет. */
function choose(me: Me, view: TipsView, groupUrl: string | undefined, phone: boolean): string | null {
  if (groupUrl && view.groupDue) return GROUP_TIP
  const [first] = tipsFor(me, { phone, telegram: Boolean(telegram()) }, view.seen ?? [], view.used ?? [])
  return first?.id ?? null
}

function TipCard({ tip, onClose, onOff }: { tip: Tip; onClose: () => void; onOff: () => void }) {
  const action = tip.action
  return (
    <TipModal label="Совет дня" onClose={onClose}>
      <div className="tip-head">
        <span className="tip-kicker"><span aria-hidden="true">💡</span> Совет дня</span>
        <button type="button" className="tip-close" aria-label="Закрыть совет" title="Закрыть" onClick={onClose}>✕</button>
      </div>
      <h2 className="tip-title">{tip.title}</h2>
      <p className="tip-text">{tip.text}</p>
      <div className="tip-actions">
        {'show' in action
          ? <button type="button" className="btn small primary" onClick={() => { onClose(); go(action.show) }}>Показать</button>
          : <button type="button" className="btn small primary" onClick={() => { onClose(); openMine('help', `guide/${action.guide}`) }}>Подробнее</button>}
        <button type="button" className="btn small" onClick={onClose}>Понятно</button>
        <button type="button" className="tip-off" onClick={onOff}>Не показывать советы</button>
      </div>
    </TipModal>
  )
}

function GroupInvite({ onJoin, onDecline, onClose }: { onJoin: () => void; onDecline: () => void; onClose: () => void }) {
  return (
    <TipModal label="Группа врачей Tish" onClose={onClose}>
      <div className="tip-head">
        <span className="tip-kicker">Приглашение</span>
        <button type="button" className="tip-close" aria-label="Закрыть приглашение" title="Закрыть" onClick={onClose}>✕</button>
      </div>
      <h2 className="tip-title"><span aria-hidden="true">👥</span> Группа врачей Tish в Telegram</h2>
      <p className="tip-text">Новости, советы коллег, ответы на вопросы.</p>
      <div className="tip-actions">
        <button type="button" className="btn small primary" onClick={onJoin}>Вступить</button>
        <button type="button" className="btn small" onClick={onDecline}>Не надо</button>
      </div>
    </TipModal>
  )
}

/** Окно по центру поверх экрана: фон затемнён, тап по фону, Esc и «Назад» телефона — закрыть. Фокус — на окно. */
function TipModal({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const box = useRef<HTMLElement>(null)
  useBack(onClose)
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null
    box.current?.querySelector<HTMLElement>('.btn.primary')?.focus()
    return () => back?.focus?.()
  }, [])
  return createPortal(
    <div className="ui-select-backdrop tip-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <section ref={box} className="tip-card" role="dialog" aria-modal="true" aria-label={label}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            onClose()
          }
        }}>
        {children}
      </section>
    </div>,
    document.body,
  )
}
