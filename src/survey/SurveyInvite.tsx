import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, unwrap, type Schemas } from '../api/client'
import { openMine } from '../lib/route'
import { CURRENT_KEY } from './keys'

type Me = Schemas['BookingViewsMe']

/**
 * Приглашение в опрос команды Tish — спокойная плашка над «Расписанием», а не окно поверх работы:
 * между пациентами его можно не заметить, и это нормально. «Позже» прячет на 3 дня (сервер помнит —
 * на всех устройствах), ответить можно и раньше: «Помощь → Отзыв о Tish». Команде платформы не
 * показываем — они опросы составляют.
 */
export function SurveyInvite({ me }: { me: Me }) {
  const client = useQueryClient()
  const staff = Boolean(me.doctor && !me.platform)
  const current = useQuery({ queryKey: CURRENT_KEY, queryFn: () => unwrap(api.GET('/api/surveys/current')), enabled: staff, staleTime: 10 * 60_000 })
  const survey = current.data?.survey
  const later = useMutation({
    mutationFn: (id: number) => unwrap(api.POST('/api/surveys/{id}/later', { params: { path: { id } } })),
    onSuccess: (r) => client.setQueryData(CURRENT_KEY, { ...current.data, snoozedUntil: r.snoozedUntil }),
  })
  // Сервер отдаёт snoozedUntil, только пока «Позже» действует
  const snoozed = Boolean(current.data?.snoozedUntil)
  if (!staff || !survey || snoozed) return null
  return (
    <div className="notices">
      <div className="notice tone-info" role="status">
        <span className="notice-ico" aria-hidden="true">📝</span>
        <button type="button" className="notice-text" onClick={() => openMine('help', 'survey')}>
          Команда Tish просит вашего мнения: «{survey.title}». 2–3 минуты. <span className="notice-open" aria-hidden="true">Пройти опрос ›</span>
        </button>
        <button type="button" className="btn ghost small" disabled={later.isPending} title="Скрыть на 3 дня" onClick={() => later.mutate(survey.id)}>Позже</button>
      </div>
    </div>
  )
}
