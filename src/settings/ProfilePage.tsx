import { useQuery } from '@tanstack/react-query'

import { api, unwrap, type Schemas } from '../api/client'
import { openSettings } from '../lib/route'
import { DoctorPanel } from '../team/DoctorPanel'
import { StaffPhone } from '../team/PhoneParts'
import { SubHeader } from './SubHeader'
import { Loading } from '../layout/Loading'

type Me = Schemas['BookingViewsMe']
type Doctor = Schemas['DoctorAdminView']

/**
 * «Мой профиль»: свой телефон (для связи и входа по номеру) — у всех, и владельца платформы тоже; врачу —
 * ещё своя карточка во всю ширину: фото, имя, «о себе» (их видят пациенты в боте), часы работы.
 * Список врачей и «Добавить врача» — в «Врачах».
 */
export function ProfilePage({ me, onBack }: { me: Me; onBack: () => void }) {
  const admin = useQuery({
    queryKey: ['doctors-admin'],
    queryFn: () => unwrap(api.GET('/api/doctors/admin')),
    enabled: Boolean(me.admin) && me.doctorId != null,
  })
  const own: Doctor | undefined = me.admin
    ? admin.data?.find((d) => d.id === me.doctorId)
    : (me.doctors ?? []).find((d) => d.id === me.doctorId)

  return (
    <section className="schedule-main">
      <SubHeader title="Мой профиль" onBack={onBack} />
      <MyPhone />
      {me.doctorId == null ? (
        <div className="card-block">
          <p>Профиль для пациентов есть у врачей: фото, имя и «о себе» видны при записи в боте.</p>
          <p className="hint">Вы и принимаете пациентов? Добавьте себя врачом в «Врачах» — «Я тоже веду приём».</p>
          <button type="button" className="btn" onClick={() => openSettings('doctors')}>Персонал</button>
        </div>
      ) : me.admin && admin.isPending ? <Loading />
        : admin.error ? <p className="error">{admin.error.message}</p>
          : own ? <DoctorPanel key={own.id} doctor={own} me={me} onClose={onBack} inline />
            : <p className="hint">Профиль не найден — обновите страницу.</p>}
    </section>
  )
}

/** «Телефон» в «Моём профиле»: свой номер для связи и входа на сайте по номеру. */
function MyPhone() {
  const phone = useQuery({ queryKey: ['me-phone'], queryFn: () => unwrap(api.GET('/api/me/phone')) })
  return (
    <section className="settings-group" aria-label="Телефон">
      <h2>Телефон</h2>
      {phone.isPending ? <Loading /> : phone.error ? <p className="error">{phone.error.message}</p>
        : <StaffPhone key={phone.data.phone ?? ''} who="me" phone={phone.data.phone} phoneOnly={phone.data.phoneOnly} />}
    </section>
  )
}
