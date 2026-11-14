import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap } from '../api/client'
import { Fold } from '../layout/Fold'
import { Spinner } from '../layout/Loading'

/**
 * «Станьте и врачом» в «Моём профиле»: руководитель (частный врач в своём кабинете) или регистратор становится и
 * врачом — со своим расписанием, часами и профилем для пациентов. Права остаются. Здесь — для тех, кто
 * ещё не врач: регистратор роли не меняет, а руководителю так проще (сразу имя для пациентов). Дальше роль
 * меняется только списком «Роль» в карточке в «Персонале».
 *
 * С 2026-11-14 свёрнуто в одну строку-приглашение «Принимаете пациентов? Станьте и врачом ›» (Fold): форма —
 * только по нажатию, кнопка обычной ширины.
 */
export function AddSelf() {
  return (
    <Fold title="Принимаете пациентов? Станьте и врачом" label="Стать врачом">
      <AddSelfForm />
    </Fold>
  )
}

function AddSelfForm() {
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
    <form className="form add-self" aria-label="Стать врачом" onSubmit={(e) => { e.preventDefault(); add.mutate() }}>
      <p className="hint">Появятся ваше расписание, часы работы и профиль для пациентов. Ваши права останутся.</p>
      <label className="field"><span>Ваше имя для пациентов</span>
        <input value={value} required maxLength={100} placeholder="Например: Айпери Исакова" onChange={(e) => setName(e.target.value)} />
      </label>
      {add.error && <p className="error" role="alert">{add.error.fieldErrors.fullName ?? add.error.message}</p>}
      <div className="actions">
        <button type="submit" className="btn primary" disabled={add.isPending}>{add.isPending ? <><Spinner />Сохраняем…</> : 'Стать врачом'}</button>
      </div>
    </form>
  )
}
