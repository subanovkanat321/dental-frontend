import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { Loading } from '../layout/Loading'
import { SubHeader } from './SubHeader'

type View = Schemas['VisitSettingsControllerVisitSettingsView']

const KEY = ['visit-settings']

/**
 * «Настройки → Приём → Отметки приёма» (V245, только руководитель — сервер отвечает 403 остальным): отмечать ли приход
 * пациента — «Пришёл» и «В кресле». По умолчанию нет: врач отмечает итог — «Приём состоялся» или «Неявка». Сохраняется
 * сразу, как переключатели «ИИ в клинике»; расписание берёт значение из clinic.markArrival — поэтому после смены
 * обновляем «me».
 */
export function VisitMarksPage({ onBack }: { onBack: () => void }) {
  const client = useQueryClient()
  const current = useQuery<View, ApiError>({ queryKey: KEY, queryFn: () => unwrap(api.GET('/api/clinic/visit-settings')) })
  const change = useMutation<View, ApiError, boolean>({
    mutationFn: (markArrival) => unwrap(api.PUT('/api/clinic/visit-settings', { body: { markArrival } })),
    onSuccess: (now) => {
      client.setQueryData(KEY, now)
      void client.invalidateQueries({ queryKey: ['me'] })
    },
  })
  const on = change.isPending ? Boolean(change.variables) : Boolean(current.data?.markArrival)
  return (
    <section className="schedule-main">
      <SubHeader title="Отметки приёма" onBack={onBack} />
      {current.isPending ? <Loading />
        : current.error ? <p className="error">{current.error.message}</p>
          : (
            <section className="card-block form" aria-label="Отметки приёма">
              <p className="hint">
                В день приёма врач отмечает итог: «✅ Приём состоялся» или «🚷 Неявка». Этого достаточно для кассы,
                отчётов и напоминаний.
              </p>
              <label className="check">
                <input type="checkbox" checked={on} disabled={change.isPending} onChange={(e) => change.mutate(e.target.checked)} />
                <span><strong>Отмечать приход пациента (Пришёл / В кресле)</strong></span>
              </label>
              <p className="hint small">
                {on
                  ? 'Включено: в карточке приёма — «🟢 Пришёл» → «💺 Начать приём» → «✅ Приём состоялся». В расписании видно, кто ждёт, а у кого приём уже идёт.'
                  : 'Выключено: главная кнопка в день приёма — сразу «✅ Приём состоялся», «Неявка» — рядом. Старые отметки «Пришёл» и «В кресле» у записей видны, как были.'}
              </p>
              {change.error && <p className="error" role="alert">{change.error.fieldErrors.markArrival ?? change.error.message}</p>}
            </section>
          )}
    </section>
  )
}
