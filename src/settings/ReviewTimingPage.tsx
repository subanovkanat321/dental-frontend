import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { Loading } from '../layout/Loading'
import { SubHeader } from './SubHeader'

type View = Schemas['ReviewSettingsControllerReviewTimingView']
type Timing = NonNullable<View['timing']>

const KEY = ['review-timing']

/** Варианты — как ReviewTiming на сервере (V224); первый — по умолчанию. */
const OPTIONS: [Timing, string, string][] = [
  ['TWO_HOURS', 'Через 2 часа после приёма', 'Анестезия прошла, впечатление свежее — так отвечают чаще всего.'],
  ['EVENING', 'Вечером в 19:00', 'В день приёма, но не раньше чем через 2 часа после него.'],
  ['NEXT_DAY', 'На следующий день в 12:00', 'Как было раньше.'],
]

/**
 * «Настройки → Сообщения пациентам → Оценка приёма» (только руководитель — сервер отвечает 403 остальным): когда бот спросит пациента
 * «Как прошёл приём?» и пять ⭐. Выбор сохраняется сразу, как переключатели «ИИ в клинике».
 */
export function ReviewTimingPage({ onBack }: { onBack: () => void }) {
  const client = useQueryClient()
  const current = useQuery<View, ApiError>({ queryKey: KEY, queryFn: () => unwrap(api.GET('/api/clinic/review-timing')) })
  const change = useMutation<View, ApiError, Timing>({
    mutationFn: (timing) => unwrap(api.PUT('/api/clinic/review-timing', { body: { timing } })),
    onSuccess: (now) => client.setQueryData(KEY, now),
  })
  const value = change.isPending ? change.variables : current.data?.timing
  return (
    <section className="schedule-main">
      <SubHeader title="Оценка приёма" onBack={onBack} />
      {current.isPending ? <Loading />
        : current.error ? <p className="error">{current.error.message}</p>
          : (
            <section className="card-block form" aria-label="Когда спрашивать оценку">
              <p className="hint">
                Пациентам, которые записывались через бота, бот сам пишет «Как прошёл приём?» с пятью ⭐. Сразу после
                «Приём состоялся» не спрашиваем — пациент ещё под анестезией. С 21:00 до 9:00 бот не пишет: поздний приём
                спросит утром в 10:00.
              </p>
              <fieldset>
                <legend>Когда спрашивать оценку</legend>
                {OPTIONS.map(([timing, title, hint]) => (
                  <label key={timing} className="check">
                    <input type="radio" name="review-timing" value={timing} checked={value === timing} disabled={change.isPending}
                      onChange={() => change.mutate(timing)} />
                    <span><strong>{title}</strong><span className="hint"> — {hint}</span></span>
                  </label>
                ))}
              </fieldset>
              <p className="hint small">
                Отправили «Сообщение после приёма» в бот — под ним сразу кнопки ⭐, отдельного вопроса уже не будет; в
                WhatsApp — в конце ссылка на оценку. Пациентов без Telegram просите «⭐ Попросить оценку» в карточке приёма.
              </p>
              {change.error && <p className="error" role="alert">{change.error.fieldErrors.timing ?? change.error.message}</p>}
            </section>
          )}
    </section>
  )
}
