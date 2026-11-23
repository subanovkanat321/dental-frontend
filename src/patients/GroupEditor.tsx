import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { api, unwrap, type ApiError, type Schemas } from '../api/client'
import { ask } from '../lib/confirm'
import { useDebounced } from '../lib/useDebounced'
import { Select } from '../layout/Select'
import { Segments } from '../layout/Segments'
import { Sheet } from '../layout/Sheet'
import { usePatientTags } from '../tags/tags'
import { GROUPS, PLAN_STATUS_TEXT, patientsText, type GroupFilter, type GroupItem, type PlanStatus } from './groupsModel'

type Me = Schemas['BookingViewsMe']

const OLDER = [3, 6, 12, 24]
const NEWER = [1, 3, 6, 12]

type Bot = 'any' | 'yes' | 'no'

/**
 * «＋ Своя группа» и ✏️ «Изменить группу»: название и простые условия (все — «и»). Пока выбираете — число подходящих
 * пациентов (POST /count, ничего не сохраняет). Пустые условия — «неважно». Удалить — внизу слева, с подтверждением.
 */
export function GroupEditor({ me, group, onClose, onSaved, onDeleted }: {
  me: Me
  /** Изменить эту группу; нет — новая */
  group?: GroupItem
  onClose: () => void
  onSaved?: (g: GroupItem) => void
  /** Группу удалили — страница группы закрывается */
  onDeleted?: () => void
}) {
  const start = group?.filter ?? { notBooked: true }
  const [name, setName] = useState(group?.name ?? '')
  const [older, setOlder] = useState(start.lastVisitOlderMonths != null ? String(start.lastVisitOlderMonths) : '')
  const [newer, setNewer] = useState(start.lastVisitNewerMonths != null ? String(start.lastVisitNewerMonths) : '')
  const [doctorId, setDoctorId] = useState(start.doctorId != null ? String(start.doctorId) : '')
  const [tagId, setTagId] = useState(start.tagId != null ? String(start.tagId) : '')
  const [serviceId, setServiceId] = useState(start.serviceTypeId != null ? String(start.serviceTypeId) : '')
  const [plan, setPlan] = useState<string>(start.planStatus ?? '')
  const [bot, setBot] = useState<Bot>(start.inBot == null ? 'any' : start.inBot ? 'yes' : 'no')
  const [ageFrom, setAgeFrom] = useState(start.ageFrom != null ? String(start.ageFrom) : '')
  const [ageTo, setAgeTo] = useState(start.ageTo != null ? String(start.ageTo) : '')
  const [notBooked, setNotBooked] = useState(Boolean(start.notBooked))
  const tags = usePatientTags()
  const services = useQuery({ queryKey: ['service-types'], queryFn: () => unwrap(api.GET('/api/service-types')), staleTime: 5 * 60_000 })
  const doctors = (me.doctors ?? []).filter((d) => d.active !== false)
  const client = useQueryClient()

  const num = (v: string) => (v.trim() === '' ? undefined : Number(v))
  const filter: GroupFilter = {
    lastVisitOlderMonths: num(older), lastVisitNewerMonths: num(newer), doctorId: num(doctorId), tagId: num(tagId),
    serviceTypeId: num(serviceId), planStatus: (plan || undefined) as PlanStatus | undefined,
    inBot: bot === 'any' ? undefined : bot === 'yes', ageFrom: num(ageFrom), ageTo: num(ageTo), notBooked: notBooked || undefined,
  }
  const empty = Object.values(filter).every((v) => v === undefined)
  const asked = useDebounced(JSON.stringify(filter))
  const count = useQuery({
    queryKey: [...GROUPS, 'count', asked],
    queryFn: () => unwrap(api.POST('/api/patient-groups/count', { body: JSON.parse(asked) as GroupFilter })),
    enabled: !empty,
    retry: false,
  })

  const save = useMutation<GroupItem, ApiError>({
    mutationFn: () => unwrap(group?.groupId != null
      ? api.PUT('/api/patient-groups/{id}', { params: { path: { id: group.groupId } }, body: { name, filter } })
      : api.POST('/api/patient-groups', { body: { name, filter } })),
    onSuccess: (g) => {
      void client.invalidateQueries({ queryKey: GROUPS })
      onSaved?.(g)
      onClose()
    },
  })
  const remove = useMutation<void, ApiError>({
    mutationFn: () => unwrap(api.DELETE('/api/patient-groups/{id}', { params: { path: { id: group!.groupId! } } })).then(() => undefined),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: GROUPS })
      onDeleted?.()
      onClose()
    },
  })
  const err = (k: string) => save.error?.fieldErrors[k]

  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate()
  }

  return (
    <Sheet label={group ? 'Изменить группу' : 'Своя группа'} title={group ? 'Изменить группу' : 'Своя группа'} onClose={onClose} wide>
      <form className="group-editor" onSubmit={submit}>
        <label className="field"><span>Название</span>
          <input value={name} required maxLength={80} autoComplete="off" placeholder="Например: детская ортодонтия, давно не были"
            onChange={(e) => setName(e.target.value)} /></label>
        {err('name') && <p className="error">{err('name')}</p>}

        <div className="group-editor-grid">
          <label className="field"><span>Последний визит больше</span>
            <Select value={older} onChange={(e) => setOlder(e.target.value)}>
              <option value="">неважно</option>
              {OLDER.map((m) => <option key={m} value={m}>{m} мес. назад</option>)}
            </Select></label>
          <label className="field"><span>Последний визит меньше</span>
            <Select value={newer} onChange={(e) => setNewer(e.target.value)}>
              <option value="">неважно</option>
              {NEWER.map((m) => <option key={m} value={m}>{m} мес. назад</option>)}
            </Select></label>
          {doctors.length > 1 && (
            <label className="field"><span>Врач</span>
              <Select value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
                <option value="">любой</option>
                {doctors.map((d) => <option key={d.id} value={d.id}>{d.fullName}</option>)}
              </Select></label>
          )}
          {(tags.data ?? []).length > 0 && (
            <label className="field"><span>Метка</span>
              <Select value={tagId} onChange={(e) => setTagId(e.target.value)}>
                <option value="">любая</option>
                {(tags.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select></label>
          )}
          <label className="field"><span>Была услуга</span>
            <Select value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
              <option value="">любая</option>
              {(services.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select></label>
          <label className="field"><span>План лечения</span>
            <Select value={plan} onChange={(e) => setPlan(e.target.value)}>
              <option value="">неважно</option>
              {(Object.keys(PLAN_STATUS_TEXT) as PlanStatus[]).map((s) => <option key={s} value={s}>{PLAN_STATUS_TEXT[s]}</option>)}
            </Select></label>
          <div className="field"><span>Возраст</span>
            <div className="row group-age">
              <input type="number" inputMode="numeric" min={0} max={120} aria-label="Возраст от" placeholder="от" value={ageFrom}
                onChange={(e) => setAgeFrom(e.target.value)} />
              <span className="hint">—</span>
              <input type="number" inputMode="numeric" min={0} max={120} aria-label="Возраст до" placeholder="до" value={ageTo}
                onChange={(e) => setAgeTo(e.target.value)} />
            </div>
          </div>
          <div className="field group-editor-wide"><span>Бот клиники</span>
            <Segments label="Бот клиники" value={bot} onChange={setBot}
              options={[{ value: 'any', label: 'Неважно' }, { value: 'yes', label: 'В боте' }, { value: 'no', label: 'Без бота' }]} />
          </div>
        </div>
        <label className="check"><input type="checkbox" checked={notBooked} onChange={(e) => setNotBooked(e.target.checked)} />
          {' '}Без записи вперёд — уже записанных звать не нужно</label>
        {err('ageTo') && <p className="error">{err('ageTo')}</p>}
        {err('lastVisitNewerMonths') && <p className="error">{err('lastVisitNewerMonths')}</p>}

        <p className="group-editor-count" aria-live="polite">
          {empty ? 'Выберите хотя бы одно условие'
            : count.data ? <>Подходит: <b className="num">{patientsText(count.data.total)}</b></>
              : count.error ? <span className="error">{count.error.message}</span> : 'Считаем…'}
        </p>
        {(save.error && !Object.keys(save.error.fieldErrors).some((k) => k === 'name' || k === 'ageTo' || k === 'lastVisitNewerMonths'))
          && <p className="error" role="alert">{save.error.message}</p>}
        {remove.error && <p className="error" role="alert">{remove.error.message}</p>}
        <div className="confirm-actions group-editor-actions">
          {group?.canEdit && (
            <button type="button" className="btn" data-tone="bad" disabled={remove.isPending}
              onClick={() => void ask(`Удалить группу «${group.name}»? Пациенты останутся, удалится только группа.`, { ok: 'Удалить' })
                .then((ok) => ok && remove.mutate())}>Удалить</button>
          )}
          <button type="submit" className="btn primary" disabled={save.isPending || empty || !name.trim()}>Сохранить</button>
        </div>
      </form>
    </Sheet>
  )
}
