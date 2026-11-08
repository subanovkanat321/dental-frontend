import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { ask } from '../lib/confirm'
import { InviteLink } from '../team/InviteLink'
import { Loading } from '../layout/Loading'

type Status = Schemas['DemoClinicServiceStatus']

/**
 * «Демо-клиника» — только владелец платформы: отдельная скрытая клиника с вымышленными пациентами для
 * показа клиникам (настоящих пациентов пилота клиенту не показываем). Завести, обновить данные к текущей
 * неделе, открыть как админ, дать гостю ссылку на сутки и закрыть гостям доступ. Демо ничего не
 * отправляет: ни напоминаний, ни SMS, ни сообщений в Telegram, ИИ в ней выключен (сервер).
 */
export function DemoClinic() {
  const client = useQueryClient()
  const status = useQuery({ queryKey: ['platform-demo'], queryFn: () => unwrap(api.GET('/api/platform/demo')) })
  const done = (s: Status) => {
    client.setQueryData(['platform-demo'], s)
    void client.invalidateQueries({ queryKey: ['platform-clinics'] })
  }
  const create = useMutation<Status, ApiError>({ mutationFn: () => unwrap(api.POST('/api/platform/demo')), onSuccess: done })
  const refresh = useMutation<Status, ApiError>({ mutationFn: () => unwrap(api.POST('/api/platform/demo/refresh')), onSuccess: done })
  const closeGuests = useMutation<Status, ApiError>({ mutationFn: () => unwrap(api.POST('/api/platform/demo/close-guests')), onSuccess: done })
  const enter = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/platform/demo/enter')),
    // Другая клиника — другие врачи и пациенты: начать заново
    onSuccess: () => window.location.reload(),
  })
  const [guest, setGuest] = useState('')
  const invite = useMutation<Schemas['DoctorInvitesInvite'], ApiError>({
    mutationFn: () => unwrap(api.POST('/api/platform/demo/invite', { body: { fullName: guest.trim() || undefined } })),
  })
  const error = status.error ?? create.error ?? refresh.error ?? closeGuests.error ?? enter.error ?? invite.error
  const s = status.data

  return (
    <section className="card-block" aria-label="Демо-клиника">
      <h2>🎭 Демо-клиника</h2>
      <p className="hint">Отдельная скрытая клиника с вымышленными врачами и пациентами — показывать Tish клиникам.
        Не видна пациентам, не в аналитике и финансах; напоминания, SMS, сообщения в Telegram и ИИ в ней не работают.</p>
      {status.isPending ? <Loading /> : !s?.clinicId ? (
        <button type="button" className="btn primary" disabled={create.isPending} onClick={() => create.mutate()}>
          {create.isPending ? 'Заполняем…' : 'Создать демо-клинику'}</button>
      ) : (
        <>
          <p className="stats">
            <span className="chip small s-quiet">Врачей: <b className="num">{s.doctors}</b></span>
            <span className="chip small s-quiet">Пациентов: <b className="num">{s.patients}</b></span>
            <span className="chip small s-quiet">Записей: <b className="num">{s.appointments}</b></span>
          </p>
          <div className="actions">
            <button type="button" className="btn primary" disabled={enter.isPending} onClick={() => enter.mutate()}>Открыть как руководитель</button>
            <button type="button" className="btn" disabled={refresh.isPending}
              onClick={() => void ask('Пересоздать вымышленные записи, оплаты и пациентов с датами от этой недели?').then((ok) => ok && refresh.mutate())}>
              {refresh.isPending ? 'Обновляем…' : 'Обновить демо-данные'}</button>
          </div>
          <p className="hint">Вернуться в свою клинику — «Платформа → Клиники» → клиника → «Войти как руководитель».</p>
          <details>
            <summary>Показать клиенту: ссылка гостю на сутки</summary>
            <div className="form">
              <p className="hint">Гость станет руководителем демо-клиники (только вымышленные данные). После показа — «Закрыть доступ гостям».</p>
              {invite.data?.token ? <InviteLink start={`staff_${invite.data.token}`} name={guest.trim()} toWhom="клиенту" /> : (
                <form className="form narrow" aria-label="Ссылка гостю" onSubmit={(e) => { e.preventDefault(); invite.mutate() }}>
                  <label className="field"><span>Кому (для «Персонала» демо)</span>
                    <input value={guest} maxLength={100} placeholder="Клиника «Улыбка»" onChange={(e) => setGuest(e.target.value)} /></label>
                  <button type="submit" className="btn" disabled={invite.isPending}>Сделать ссылку</button>
                </form>
              )}
            </div>
          </details>
          {(s.guests?.length ?? 0) > 0 && (
            <div className="sub-form form">
              <span>Гости сейчас: {s.guests!.join(', ')}</span>
              <button type="button" className="btn" disabled={closeGuests.isPending} onClick={() => closeGuests.mutate()}>Закрыть доступ гостям</button>
            </div>
          )}
        </>
      )}
      {error && <p className="error" role="alert">{error.message}</p>}
    </section>
  )
}
