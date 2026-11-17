import { useState } from 'react'

import type { Schemas } from '../api/client'
import type { TaskPatient } from '../tasks/TaskDialog'
import { useLabOrders } from './api'
import { LabOrderDialog } from './LabOrderDialog'
import { LabRow } from './LabRow'
import { useLabActions } from './useLabActions'
import './lab.css'

type Me = Schemas['BookingViewsMe']

/**
 * Блок «Лаборатория» в карточке пациента: его работы (ещё не установленные — все, установленные — последние три) и
 * «＋ Заказ в лабораторию» с этим пациентом. Работ нет — только кнопка.
 */
export function PatientLab({ me, patient }: { me: Me; patient: TaskPatient }) {
  const list = useLabOrders({ patientId: patient.id })
  const { actions, dialogs, error, busyId } = useLabActions(me)
  const [creating, setCreating] = useState(false)
  const all = list.data ?? []
  const shown = [...all.filter((o) => o.status !== 'FITTED'), ...all.filter((o) => o.status === 'FITTED').slice(-3)]
  return (
    <section className="patient-lab" aria-label="Лаборатория пациента">
      <div className="patient-lab-head">
        {shown.length > 0 && <h3>Лаборатория <span className="hint">{shown.length}</span></h3>}
        <button type="button" className="btn small" onClick={() => setCreating(true)}>＋ Заказ в лабораторию</button>
      </div>
      {shown.length > 0 && (
        <ul className="calm-list">
          {shown.map((o) => <LabRow key={o.id} order={o} showPatient={false} busy={busyId === o.id} actions={{ ...actions, onOpenPatient: undefined }} />)}
        </ul>
      )}
      {error && <p className="error" role="alert">{error.message}</p>}
      {creating && <LabOrderDialog me={me} preset={{ patient }} onClose={() => setCreating(false)} />}
      {dialogs}
    </section>
  )
}
