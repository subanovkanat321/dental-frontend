import { useState } from 'react'

import type { Schemas } from '../api/client'
import { EditButton } from '../layout/EditButton'
import { EmptyState } from '../layout/EmptyState'
import { Loading, Spinner } from '../layout/Loading'
import { HeadTools, SubHelp } from '../layout/PageHead'
import { Select } from '../layout/Select'
import { Sheet } from '../layout/Sheet'
import { shortDate } from '../lib/time'
import { usePatientTags } from '../tags/tags'
import { CalmRow } from './CalmList'
import { GroupCall, MessageProgress } from './GroupCall'
import { GroupEditor } from './GroupEditor'
import {
  READY_HINT, filterText, keyOf, patientsText, refOf, useGroups, useMembers, type GroupItem, type GroupRef,
} from './groupsModel'
import './groups.css'

type Me = Schemas['BookingViewsMe']

const PAGE = 50

/**
 * «Пациенты → Группы» (шаг 9А): готовые группы с числом, по меткам и свои группы клиники. Нажали группу — её пациенты
 * и одна главная кнопка «Позвать группу» (задачи на обзвон или сообщение). Кого показывать, решает сервер: руководитель
 * и регистратура — всю клинику, врач — своих.
 */
export function GroupsTab({ me, onOpen }: { me: Me; onOpen: (patientId: number) => void }) {
  const groups = useGroups()
  const [open, setOpen] = useState<{ ref: GroupRef; item?: GroupItem } | null>(null)
  const [editing, setEditing] = useState<GroupItem | 'new' | null>(null)
  const tags = usePatientTags()
  const doctorName = (id?: number) => me.doctors?.find((d) => d.id === id)?.fullName
  const tagName = (id?: number) => tags.data?.find((t) => t.id === id)?.name
  // Своя группа — свежая из списка (переименовали — видно сразу), пока список не обновился — как открыли
  const customId = open?.item?.groupId
  const fresh = (customId != null ? groups.data?.custom.find((g) => g.groupId === customId) : undefined) ?? open?.item

  if (open) {
    return (
      <>
        <GroupPage me={me} group={open.ref} item={fresh} onBack={() => setOpen(null)} onOpen={onOpen}
          onEdit={fresh?.canEdit ? () => setEditing(fresh) : undefined} />
        {editing && editing !== 'new' && (
          <GroupEditor me={me} group={editing} onClose={() => setEditing(null)} onDeleted={() => setOpen(null)} />
        )}
      </>
    )
  }

  const row = (g: GroupItem, sub: string) => (
    <CalmRow key={keyOf(refOf(g))} open={() => setOpen({ ref: refOf(g), item: g })} name={g.name} sub={sub}
      meta={<span className={g.count ? 'num calm-meta-strong' : 'num'}>{g.count}</span>}
      action={g.kind === 'CUSTOM' && g.canEdit ? <EditButton label={`Изменить группу: ${g.name}`} onClick={() => setEditing(g)} /> : undefined} />
  )

  return (
    <div className="calm-stack groups">
      <SubHelp title="Группы">Готовые группы пациентов и ваши свои: кто давно не был, бросил лечение, должен, у кого день рождения.
        Откройте группу — «Позвать группу»: задачи на обзвон каждому или сообщение (в бот — само, без бота — WhatsApp по очереди).
        Одному пациенту — не чаще одного такого сообщения в неделю.</SubHelp>
      <HeadTools>
        <button type="button" className="btn primary" onClick={() => setEditing('new')}>＋ Своя группа</button>
      </HeadTools>
      {groups.isPending && <Loading />}
      {groups.error && <p className="error">{groups.error.message}</p>}
      {groups.data && (
        <>
          <section className="calm-day" aria-label="Готовые группы">
            <h3>Готовые</h3>
            <ul className="calm-list">{groups.data.ready.map((g) => row(g, g.ready ? READY_HINT[g.ready] : ''))}</ul>
          </section>
          {groups.data.tags.length > 0 && (
            <section className="calm-day" aria-label="По меткам">
              <h3>По меткам</h3>
              <ul className="calm-list">{groups.data.tags.map((g) => row(g, 'Все с этой меткой'))}</ul>
            </section>
          )}
          <section className="calm-day" aria-label="Свои группы">
            <h3>Свои</h3>
            {groups.data.custom.length ? (
              <ul className="calm-list">
                {groups.data.custom.map((g) => row(g, filterText(g.filter, { doctor: doctorName(g.filter?.doctorId), tag: tagName(g.filter?.tagId) })))}
              </ul>
            ) : (
              <EmptyState compact title="Своих групп пока нет">
                «＋ Своя группа» — например, «Ортодонтия, не были 6+ месяцев» или «Без бота, были за год».
              </EmptyState>
            )}
          </section>
        </>
      )}
      {editing === 'new' && (
        <GroupEditor me={me} onClose={() => setEditing(null)} onSaved={(g) => setOpen({ ref: refOf(g), item: g })} />
      )}
      {editing && editing !== 'new' && <GroupEditor me={me} group={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

/** Страница группы: пациенты (имя · был · врач · почему), «Врач: …», одна кнопка «Позвать группу», что уже делали. */
function GroupPage({ me, group, item, onBack, onOpen, onEdit }: {
  me: Me
  group: GroupRef
  item?: GroupItem
  onBack: () => void
  onOpen: (patientId: number) => void
  onEdit?: () => void
}) {
  const [limit, setLimit] = useState(PAGE)
  const [doctorId, setDoctorId] = useState<number | null>(null)
  const [calling, setCalling] = useState(false)
  const [message, setMessage] = useState<number | null>(null)
  const members = useMembers(group, doctorId, limit)
  const data = members.data
  const doctors = (me.doctors ?? []).filter((d) => d.active !== false)
  // «Врач: …» — тем, кто видит всю клинику (врачу сервер и так отдаёт только его пациентов)
  const pickDoctor = doctors.length > 1 && (me.admin || me.reception)
  const name = data?.name ?? item?.name ?? 'Группа'
  return (
    <div className="calm-stack groups">
      <div className="group-head">
        <button type="button" className="link group-back" onClick={onBack}>‹ Все группы</button>
        <h2 className="group-title">{name}{onEdit && <EditButton label="Изменить группу" onClick={onEdit} />}</h2>
      </div>
      {/* Своя строка инструментов под заголовком группы (не в шапке раздела): сначала «какая группа», потом что с ней делать */}
      <div className="group-tools">
        {pickDoctor && (
          <Select aria-label="Врач" value={doctorId ?? ''} onChange={(e) => { setDoctorId(e.target.value ? Number(e.target.value) : null); setLimit(PAGE) }}>
            <option value="">Все врачи</option>
            {doctors.map((d) => <option key={d.id} value={d.id}>{d.fullName}</option>)}
          </Select>
        )}
        {data && (
          <span className="head-note" aria-label="В группе">
            <b className="num">{patientsText(data.total)}</b>{data.total > 0 && <> · в боте <span className="num">{data.inBot}</span></>}
          </span>
        )}
        <button type="button" className="btn primary group-call-btn" disabled={!data || data.total === 0} onClick={() => setCalling(true)}>Позвать группу</button>
      </div>
      {members.isPending && <Loading />}
      {members.error && <p className="error">{members.error.message}</p>}
      {data && data.total === 0 && (
        <EmptyState fill title="В группе никого нет">Сейчас никто не подходит — загляните позже или выберите другого врача.</EmptyState>
      )}
      {data && data.patients.length > 0 && (
        <ul className="calm-list" aria-label={name}>
          {data.patients.map((p) => (
            <CalmRow key={p.patientId} open={() => onOpen(p.patientId)} name={p.fullName}
              flags={p.optedOut ? <span className="chip calm-flag s-quiet" title="Нажал в боте «Не присылать такие сообщения»">без сообщений</span> : undefined}
              sub={[p.reason, p.doctor].filter(Boolean).join(' · ')}
              meta={<span>{p.lastVisit ? `был ${shortDate(p.lastVisit)}` : 'ещё не был'}</span>} />
          ))}
        </ul>
      )}
      {data && data.patients.length < data.total && (
        <button type="button" className="btn comeback-more" disabled={members.isFetching} onClick={() => setLimit(limit + PAGE)}>
          {members.isFetching ? <><Spinner />Загрузка…</> : `Показать ещё (${Math.min(PAGE, data.total - data.patients.length)} из ${data.total - data.patients.length})`}
        </button>
      )}
      {data && data.history.length > 0 && (
        <section className="calm-day" aria-label="Что уже делали">
          <h3>Что уже делали</h3>
          <ul className="calm-list">
            {data.history.map((h) => (
              <CalmRow key={h.id} open={h.kind === 'MESSAGE' ? () => setMessage(h.id) : null}
                name={h.kind === 'MESSAGE' ? 'Сообщение' : 'Задачи на обзвон'}
                sub={`${shortDate(h.at, true)} · ${h.by}${h.skipped ? ` · пропущено ${h.skipped}` : ''}`}
                meta={(
                  <>
                    <span className="calm-meta-strong">{h.kind === 'MESSAGE' ? 'дошло' : 'задач'} <span className="num">{h.reached}</span></span>
                    <span>записались <span className="num">{h.booked}</span></span>
                  </>
                )} />
            ))}
          </ul>
          <p className="calm-note">«Записались» — сколько из них записались в течение 30 дней после сообщения или задачи.</p>
        </section>
      )}
      {calling && data && <GroupCall group={{ ...group, doctorId: doctorId ?? undefined }} members={data} onClose={() => setCalling(false)} />}
      {message != null && (
        <Sheet label="Сообщение группе" title="Сообщение группе" onClose={() => setMessage(null)} wide>
          <MessageProgress id={message} />
        </Sheet>
      )}
    </div>
  )
}
