import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { Loading } from '../layout/Loading'
import { SubHelp } from '../layout/PageHead'
import { SubHeader } from './SubHeader'

type Me = Schemas['BookingViewsMe']
type Setting = Schemas['VisitEditControllerSetting']
type Window = NonNullable<Setting['doctorWindow']>

const WINDOWS: [Window, string, string][] = [
  ['SAME_DAY', 'Только в день приёма', 'На следующий день услуги, заметку и зубы меняет руководитель (так сначала)'],
  ['ALWAYS', 'Всегда', 'Врач и регистратура меняют состоявшийся приём когда угодно'],
]

/**
 * «Настройки → Правка приёмов» (шаг 5А, V245 бэкенда): когда врач может менять состоявшийся приём — услуги, заметку и
 * зубы. Руководитель может всегда, его правка прошлого приёма — в журнале действий. Меняет руководитель (403 остальным).
 */
export function VisitEditPage({ me, onBack }: { me: Me; onBack: () => void }) {
  const client = useQueryClient()
  const setting = useQuery({ queryKey: ['visit-edit'], queryFn: () => unwrap(api.GET('/api/clinic/visit-edit')), staleTime: 5 * 60_000 })
  const save = useMutation<Setting, ApiError, Window>({
    mutationFn: (doctorWindow) => unwrap(api.PUT('/api/clinic/visit-edit', { body: { doctorWindow } })),
    onSuccess: (s) => client.setQueryData(['visit-edit'], s),
  })
  const admin = Boolean(me.admin)
  const current = setting.data?.doctorWindow ?? 'SAME_DAY'
  return (
    <section className="schedule-main settings visit-edit-page">
      <SubHeader title="Правка приёмов" onBack={onBack}>
        <SubHelp title="Правка приёмов">Состоявшийся приём — документ: на следующий день врач его не меняет, только смотрит
          («🔒 изменить может руководитель»). Руководитель может всегда — такая правка видна в журнале действий.</SubHelp>
      </SubHeader>
      {setting.isPending ? <Loading /> : setting.error ? <p className="error" role="alert">{setting.error.message}</p> : (
        <div className="card-block discount-form">
          <h2>Врач может менять состоявшийся приём</h2>
          <div className="radio-list" role="radiogroup" aria-label="Врач может менять состоявшийся приём">
            {WINDOWS.map(([code, title, hint]) => (
              <label key={code} className="radio-row">
                <input type="radio" name="doctor-window" checked={current === code} disabled={!admin || save.isPending}
                  onChange={() => save.mutate(code)} />
                <span><b>{title}</b><span className="hint small"> — {hint}</span></span>
              </label>
            ))}
          </div>
          <p className="hint small">Оплата и доплата — по своим правилам: этот запрет их не касается.</p>
          {save.error && <p className="error" role="alert">{save.error.message}</p>}
          {save.isSuccess && <p className="tone-ok" role="status">✓ Сохранено</p>}
          {!admin && <p className="hint">Настройку меняет руководитель клиники.</p>}
        </div>
      )}
    </section>
  )
}
