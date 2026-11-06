import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { api, unwrap } from '../api/client'
import { EmptyState } from '../layout/EmptyState'
import { openSettings } from '../lib/route'
import { SubHeader } from '../settings/SubHeader'
import { CURRENT_KEY } from './keys'
import { SurveyForm } from './SurveyForm'
import { Loading } from '../layout/Loading'

/**
 * «Настройки → Отзыв о Tish»: опрос команды Tish, который ждёт ответа этого сотрудника (сюда ведёт
 * приглашение на «Расписании» и кнопка бота). Опроса нет — спасибо и путь в техподдержку: идея
 * не должна ждать следующего опроса.
 */
export function SurveyPage({ onBack }: { onBack: () => void }) {
  const current = useQuery({ queryKey: CURRENT_KEY, queryFn: () => unwrap(api.GET('/api/surveys/current')) })
  // Ответ отправлен — форма показывает «Спасибо», хотя запрос «какой опрос» уже вернёт пусто
  const [answered, setAnswered] = useState<Parameters<typeof SurveyForm>[0]['form'] | null>(null)
  const form = answered ?? current.data?.survey
  return (
    <div className="schedule-main survey-page">
      <SubHeader title="Отзыв о Tish" onBack={onBack} />
      {current.error && <p className="error">{current.error.message}</p>}
      {current.isPending ? <Loading /> : form ? (
        <SurveyForm key={form.id} form={form} onDone={() => setAnswered(form)} />
      ) : (
        <EmptyState title="Сейчас опросов нет — спасибо, что заглянули!"
          action={<button type="button" className="btn" onClick={() => openSettings('support')}>Написать в техподдержку</button>}>
          Есть идея или что-то мешает в работе — напишите команде Tish, мы читаем каждое сообщение.
        </EmptyState>
      )}
    </div>
  )
}
