import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap } from '../api/client'

/**
 * «Веду приём» в «Моём профиле»: руководитель (частный врач в своём кабинете) или регистратор становится и
 * врачом — со своим расписанием, часами и профилем для пациентов. Права остаются. Здесь — для тех, кто
 * ещё не врач: регистратор роли не меняет, а руководителю так проще (сразу имя для пациентов). Дальше роль
 * меняется только списком «Роль» в карточке в «Персонале» — флажка «Веду приём» там больше нет.
 */
export function AddSelf() {
  const client = useQueryClient()
  const own = useQuery({ queryKey: ['me-name'], queryFn: () => unwrap(api.GET('/api/me/name')) })
  const [name, setName] = useState<string | null>(null)
  const value = name ?? own.data?.fullName ?? ''
  const add = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/doctors/me', { body: { fullName: value } })),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['me'] })
      void client.invalidateQueries({ queryKey: ['doctors-admin'] })
    },
  })
  return (
    <form className="form sub-form" aria-label="Веду приём" onSubmit={(e) => { e.preventDefault(); add.mutate() }}>
      <p className="hint">Вы и принимаете пациентов? Станьте и врачом — появится ваше расписание, часы работы и профиль для пациентов.</p>
      <label className="field"><span>Ваше имя для пациентов</span>
        <input value={value} required maxLength={100} onChange={(e) => setName(e.target.value)} />
      </label>
      {add.error && <p className="error" role="alert">{add.error.fieldErrors.fullName ?? add.error.message}</p>}
      <button type="submit" className="btn" disabled={add.isPending}>Веду приём</button>
    </form>
  )
}
