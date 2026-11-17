import { useMutation, useQueryClient } from '@tanstack/react-query'

import { api, ApiError, unwrap, type Schemas } from '../api/client'

type Patient = Schemas['PatientView']

/**
 * «⭐ ВИП — особое внимание» во вкладке «Прочее» карточки пациента (V223 бэкенда): звезда на его записях в
 * расписании и в карточке приёма. Ставят руководитель и регистратура (сервер проверит); остальным — только строка,
 * если отметка есть. Пациент её нигде не видит.
 */
export function VipBox({ patient, canEdit }: { patient: Patient; canEdit: boolean }) {
  const client = useQueryClient()
  const save = useMutation<Patient, ApiError, boolean>({
    mutationFn: (vip) => unwrap(api.PUT('/api/patients/{id}/vip', { params: { path: { id: patient.id } }, body: { vip } })),
    onSuccess: () => {
      for (const key of ['patient-card', 'appointments', 'patients', 'appointment']) void client.invalidateQueries({ queryKey: [key] })
    },
  })
  if (!canEdit && !patient.vip) return null
  return (
    <section className="vip-box" aria-label="Особое внимание">
      {canEdit ? (
        <label className="check">
          <input type="checkbox" checked={Boolean(patient.vip)} disabled={save.isPending} onChange={(e) => save.mutate(e.target.checked)} />
          {' '}⭐ ВИП — особое внимание
        </label>
      ) : <p>⭐ ВИП — особое внимание</p>}
      <p className="hint small">Звезда на записях в расписании — встретить и не заставлять ждать. Пациент её не видит.</p>
      {save.error && <p className="error" role="alert">{save.error.message}</p>}
    </section>
  )
}
