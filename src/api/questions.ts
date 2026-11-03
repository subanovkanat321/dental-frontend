import { useQuery } from '@tanstack/react-query'

import { api, unwrap } from './client'

/**
 * Сколько вопросов пациентов ждут ответа (только тех, кого сотрудник видит, — считает сервер): бейдж
 * у «Пациентов» и на вкладке «Вопросы». Раз в минуту — новые приходят из бота без перезагрузки.
 */
export function useNewQuestions(enabled = true) {
  return useQuery({
    queryKey: ['patient-questions', 'count'],
    queryFn: () => unwrap(api.GET('/api/patient-questions/new-count')),
    enabled,
    refetchInterval: 60_000,
  })
}
