import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { groupLabel, groupServices } from '../clinic/services'
import { SaveBar } from '../layout/SaveBar'
import { chosenServiceIds } from '../lib/doctorServices'
import { useDirty } from '../lib/unsaved'
import { Loading } from '../layout/Loading'
import { EmptyState } from '../layout/EmptyState'

type Me = Schemas['BookingViewsMe']

/**
 * «Услуги врача» в его карточке: все услуги клиники (как по умолчанию) или только отмеченные —
 * их пациент увидит у этого врача в боте, а регистратура — в «Новой записи». Менять — админ или
 * сам врач (проверяет сервер).
 */
export function DoctorServices({ doctorId, me }: { doctorId: number; me: Me }) {
  const client = useQueryClient()
  const services = useQuery({
    queryKey: ['service-types'],
    queryFn: () => unwrap(api.GET('/api/service-types')),
    select: (list) => list.filter((s) => s.active !== false),
  })
  const saved = chosenServiceIds(me.doctorServices, doctorId)
  const [some, setSome] = useState(saved != null)
  const [picked, setPicked] = useState<number[]>(saved ?? [])
  const { dirty, commit } = useDirty(some ? [...picked].sort((a, b) => a - b) : null)
  const [problem, setProblem] = useState('')
  const save = useMutation<Schemas['DoctorServicesView'], ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/doctors/{id}/service-types', {
      params: { path: { id: doctorId } }, body: { serviceTypeIds: some ? picked : [] },
    })),
    onSuccess: () => {
      commit()
      void client.invalidateQueries({ queryKey: ['me'] })
    },
  })
  const toggle = (id: number, on: boolean) => {
    save.reset()
    setProblem('')
    setPicked(on ? [...picked, id] : picked.filter((x) => x !== id))
  }
  const choose = (next: boolean) => {
    save.reset()
    setProblem('')
    setSome(next)
  }
  const submit = () => {
    if (some && !picked.length) {
      setProblem('Отметьте хотя бы одну услугу или выберите «Все услуги клиники»')
      return
    }
    save.mutate()
  }
  const list = services.data ?? []

  return (
    <section className="form" aria-label="Услуги врача">
      <h4>Услуги врача</h4>
      <p className="hint">Их пациент видит у этого врача, когда записывается в боте, и регистратура — в «Новой записи». Цены — общие для клиники («Клиника → Услуги и цены»), здесь — какие услуги врач делает.</p>
      <div className="segments" role="group" aria-label="Какие услуги">
        <button type="button" aria-pressed={!some} onClick={() => choose(false)}>Все услуги клиники</button>
        <button type="button" aria-pressed={some} onClick={() => choose(true)}>Только выбранные</button>
      </div>
      {some && (services.isPending ? <Loading /> : list.length ? (
        <div className="doctor-services">
          {groupServices(list).map(({ group, items }) => (
            <fieldset key={group} className="field">
              <legend>{groupLabel(group)}</legend>
              {items.map((s) => (
                <label key={s.id} className="check">
                  <input type="checkbox" checked={picked.includes(s.id)} onChange={(e) => toggle(s.id, e.target.checked)} /> {s.name}
                </label>
              ))}
            </fieldset>
          ))}
          <p className="hint small">Новую услугу клиники сюда нужно будет отметить отдельно.</p>
        </div>
      ) : <EmptyState compact title="Услуг пока нет">Добавьте их в «Клиника → Услуги и цены».</EmptyState>)}
      <SaveBar dirty={dirty} saving={save.isPending} saved={save.isSuccess} label="Сохранить услуги" savedText="Услуги врача сохранены"
        error={problem || (save.error && (Object.values(save.error.fieldErrors)[0] ?? save.error.message))} onSave={submit} />
    </section>
  )
}
