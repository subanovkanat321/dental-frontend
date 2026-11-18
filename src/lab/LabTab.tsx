import { useState } from 'react'

import type { Schemas } from '../api/client'
import { somText } from '../lib/time'
import { DirectorySheet } from '../clinic/DirectorySheet'
import { EmptyState } from '../layout/EmptyState'
import { Fold } from '../layout/Fold'
import { HeadTools } from '../layout/PageHead'
import { Loading } from '../layout/Loading'
import { Select } from '../layout/Select'
import { useArchiveLab, useLabDebts, useLabOrder, useLabOrders, useLabs, type Lab } from './api'
import { LabForm, LabOrderDialog } from './LabOrderDialog'
import { LabRow } from './LabRow'
import { groupOrders, seesLabMoney } from './text'
import { useLabActions } from './useLabActions'
import './lab.css'

type Me = Schemas['BookingViewsMe']

/**
 * «Склад → Лаборатория»: заказ-наряды технику спокойным списком — «Ждём» (по сроку, просроченные — красным),
 * «Готово — ждёт установки» (по примерке), свёрнуто «Установлено». Фильтры — лаборатория и врач (тем, кто видит
 * всех); сверху — «Должны лабораториям: N сом» (кто видит расходы). «Лаборатории» — справочник, «＋ Заказ» — новый.
 */
export function LabTab({ me, initialOrder, onOpenPatient }: {
  me: Me
  /** «Открыть» под предупреждением в боте — этот заказ */
  initialOrder?: number
  onOpenPatient?: (patientId: number) => void
}) {
  const [labId, setLabId] = useState<number | ''>('')
  const [doctorId, setDoctorId] = useState<number | ''>('')
  const filter = { labId: labId === '' ? undefined : labId, doctorId: doctorId === '' ? undefined : doctorId }
  const open = useLabOrders({ fitted: false, ...filter })
  const [showFitted, setShowFitted] = useState(false)
  // Архив грузим сразу: пустой — строки «Установлено» нет вовсе (под «Работ нет» она сбивала с толку)
  const fitted = useLabOrders({ fitted: true, ...filter }, true)
  const labs = useLabs()
  const money = seesLabMoney(me)
  const debts = useLabDebts(money)
  const { actions, dialogs, error, busyId } = useLabActions(me, onOpenPatient)
  const [creating, setCreating] = useState(false)
  const [directory, setDirectory] = useState(false)
  const seesAll = Boolean(me.admin || me.reception)
  const doctors = (me.doctors ?? []).filter((d) => d.active !== false)
  const groups = groupOrders(open.data ?? [])

  // Пришли из бота («Открыть» под предупреждением) — сразу этот заказ; закрыли — больше не открываем
  const [linkClosed, setLinkClosed] = useState(false)
  const linked = useLabOrder(initialOrder)
  const linkedOrder = !linkClosed && linked.data ? linked.data : null

  const row = (o: Schemas['LabOrderView']) => (
    <LabRow key={o.id} order={o} showDoctor={seesAll && doctorId === ''} busy={busyId === o.id} actions={actions} />
  )

  return (
    <div className="calm-stack lab">
      <HeadTools>
        {(labs.data?.length ?? 0) > 1 && (
          <Select aria-label="Лаборатория" value={labId} onChange={(e) => setLabId(e.target.value === '' ? '' : Number(e.target.value))}>
            <option value="">Все лаборатории</option>
            {labs.data!.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
        )}
        {seesAll && doctors.length > 1 && (
          <Select aria-label="Врач" value={doctorId} onChange={(e) => setDoctorId(e.target.value === '' ? '' : Number(e.target.value))}>
            <option value="">Все врачи</option>
            {doctors.map((d) => <option key={d.id} value={d.id}>{d.fullName}</option>)}
          </Select>
        )}
        <button type="button" className="btn" onClick={() => setDirectory(true)}>Лаборатории</button>
        <button type="button" className="btn primary head-end" onClick={() => setCreating(true)}>＋ Заказ</button>
      </HeadTools>

      {money && debts.data && debts.data.totalSom > 0 && (
        <p className="lab-debts" role="status">
          Должны лабораториям: <strong className="num">{somText(debts.data.totalSom)}</strong>
          {debts.data.labs.length > 1 && (
            <span className="hint"> · {debts.data.labs.map((l) => `${l.name} — ${somText(l.som)}`).join(', ')}</span>
          )}
        </p>
      )}
      {error && <p className="error" role="alert">{error.message}</p>}
      {open.isPending && <Loading />}
      {open.error && <p className="error">{open.error.message}</p>}
      {open.isSuccess && groups.waiting.length === 0 && groups.ready.length === 0 && (
        <EmptyState fill title="Работ в лаборатории нет">
          Отправили слепок технику — «＋ Заказ»: работа, зубы, срок и примерка. За день до примерки Tish напомнит, если работа ещё не пришла.
        </EmptyState>
      )}
      {groups.waiting.length > 0 && (
        <section className="calm-day lab-group" aria-label="Ждём">
          <h3>Ждём <span className="hint">{groups.waiting.length}</span></h3>
          <ul className="calm-list">{groups.waiting.map(row)}</ul>
        </section>
      )}
      {groups.ready.length > 0 && (
        <section className="calm-day lab-group" aria-label="Готово — ждёт установки">
          <h3>Готово — ждёт установки <span className="hint">{groups.ready.length}</span></h3>
          <ul className="calm-list">{groups.ready.map(row)}</ul>
        </section>
      )}
      {(fitted.data?.length ?? 0) > 0 && (
        <Fold title="Установлено пациентам" meta={fitted.data!.length} label="Установленные работы"
          defaultOpen={showFitted} onToggle={setShowFitted}>
          <ul className="calm-list">{fitted.data!.map(row)}</ul>
        </Fold>
      )}

      {creating && <LabOrderDialog me={me} onClose={() => setCreating(false)} />}
      {linkedOrder && <LabOrderDialog key={linkedOrder.id} me={me} order={linkedOrder} onClose={() => setLinkClosed(true)} />}
      {directory && <LabsDialog onClose={() => setDirectory(false)} />}
      {dialogs}
    </div>
  )
}

/** Справочник лабораторий — тот же лист, что «Поставщики» (DirectorySheet): «Убрать» — старые заказы остаются. */
function LabsDialog({ onClose }: { onClose: () => void }) {
  const labs = useLabs()
  const archive = useArchiveLab()
  return (
    <DirectorySheet<Lab> title="Лаборатории" intro="Зуботехнические лаборатории: номер — для заказа технику в WhatsApp и звонка."
      items={labs.data} pending={labs.isPending} addText="＋ Лаборатория" onClose={onClose}
      archive={{ keeps: 'Старые заказы останутся.', run: archive.mutate, error: archive.error }}
      form={(l, done, cancel) => <LabForm lab={l} onSaved={done} onCancel={cancel} />} />
  )
}
