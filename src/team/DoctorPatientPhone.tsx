import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { PhoneInput } from '../clinic/PhoneInput'
import { phoneFromInput, phoneToInput } from '../clinic/phone'
import { Loading } from '../layout/Loading'
import { SaveBar } from '../layout/SaveBar'
import { useDirty } from '../lib/unsaved'

type PatientPhone = Schemas['DoctorServicePatientPhone']

/**
 * «Телефон для пациентов» в карточке врача (V252 бэкенда): номер, который врач разрешил давать пациентам. Это не номер
 * входа — тот личный и пациентам не показывается. Указывают сам врач и руководитель (сервер проверяет то же, регистратуре
 * и коллеге — 403). Включила клиника «Номер в напоминаниях → Номер врача приёма» — этот номер уходит его пациентам в
 * напоминаниях о приёме вместо номера клиники; пусто — номер клиники.
 */
export function DoctorPatientPhone({ doctorId, self }: { doctorId: number; self: boolean }) {
  const phone = useQuery({
    queryKey: ['doctor-patient-phone', doctorId],
    queryFn: () => unwrap(api.GET('/api/doctors/{id}/patient-phone', { params: { path: { id: doctorId } } })),
    retry: false,
  })
  if (phone.isPending) return <Loading />
  if (phone.error) return <p className="error">{phone.error.message}</p>
  return <PhoneForm key={doctorId} doctorId={doctorId} self={self} saved={phone.data} />
}

function PhoneForm({ doctorId, self, saved }: { doctorId: number; self: boolean; saved: PatientPhone }) {
  const client = useQueryClient()
  const [value, setValue] = useState(() => phoneToInput(saved.phone))
  const { dirty, commit } = useDirty({ phone: phoneFromInput(value) })
  const save = useMutation<PatientPhone, ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/doctors/{id}/patient-phone', {
      params: { path: { id: doctorId } }, body: { phone: phoneFromInput(value) },
    })),
    onSuccess: (p) => {
      commit()
      client.setQueryData(['doctor-patient-phone', doctorId], p)
      // WhatsApp-напоминание берёт номера врачей из /api/settings
      void client.invalidateQueries({ queryKey: ['settings'] })
    },
  })
  return (
    <div className="doctor-patient-phone" role="group" aria-label="Телефон для пациентов">
      <label className="field">
        <span>Телефон для пациентов</span>
        <PhoneInput label="Телефон для пациентов" value={value} onChange={(v) => { save.reset(); setValue(v) }} />
      </label>
      <p className="hint small">
        {self
          ? 'Номер, по которому вам могут звонить пациенты. Если клиника выбрала «Номер врача приёма», он уйдёт вашим пациентам в напоминаниях вместо номера клиники. Номер для входа пациенты не видят.'
          : 'Номер, который врач разрешил давать пациентам. Если в «Настройках → Напоминание о приёме» выбран «Номер врача приёма», он уйдёт пациентам врача в напоминаниях. Номер для входа пациенты не видят.'}
      </p>
      <SaveBar dirty={dirty} saving={save.isPending} saved={save.isSuccess} savedText="Телефон сохранён" label="Сохранить телефон"
        error={save.error && (save.error.fieldErrors.phone ?? save.error.message)} onSave={() => save.mutate()} />
    </div>
  )
}
