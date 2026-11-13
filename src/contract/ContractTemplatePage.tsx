import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { SaveBar } from '../layout/SaveBar'
import { Loading } from '../layout/Loading'
import { useDirty } from '../lib/unsaved'
import { formatPhone } from '../lib/time'
import { SubHeader } from '../settings/SubHeader'
import { fillContract, unknownContractVariables } from './template'
import './contract.css'

type Me = Schemas['BookingViewsMe']
type Template = Schemas['PatientContractsTemplate']

/** Вымышленный пациент предпросмотра — настоящих данных здесь нет. */
const SAMPLE = { patient: 'Айгуль Асанова', birth: '15.04.1990', phone: '+996 555 000 000' }

/**
 * «Настройки → Договор с пациентом» (только админ): шаблон договора на стоматологические услуги и
 * информированного согласия на лечение — текст с подстановками кнопками в позицию курсора, реквизиты
 * клиники ({реквизиты}) и предпросмотр на вымышленном пациенте. Это образец, а не юридическая
 * консультация — клиника проверяет текст у юриста. Пустой текст — снова шаблон по умолчанию.
 * Сверху — «Предлагать договор всем пациентам» (V209 бэкенда, по умолчанию выключено): договор по
 * желанию — обычно его оформляют не всем, а по кнопке «⋯ → Оформить договор» у нужного пациента.
 */
export function ContractTemplatePage({ me, onBack }: { me: Me; onBack: () => void }) {
  const template = useQuery({
    queryKey: ['contract-template'],
    queryFn: () => unwrap(api.GET('/api/clinic/contract-template')),
  })
  return (
    <section className="schedule-main">
      <SubHeader title="Договор с пациентом" onBack={onBack} />
      <OfferAll me={me} />
      {template.isPending ? <Loading />
        : template.error ? <p className="error">{template.error.message}</p>
          : <Editor me={me} template={template.data} />}
    </section>
  )
}

/**
 * Переключатель «Предлагать договор всем пациентам» — сохраняется сразу (как настройки ИИ), без кнопки
 * «Сохранить» шаблона. Состояние — clinic.patientContracts из /api/patient/me: после сохранения обновим
 * его в кэше, и карточки пациентов сразу покажут или спрячут строку договора.
 */
function OfferAll({ me }: { me: Me }) {
  const client = useQueryClient()
  const on = Boolean(me.clinic?.patientContracts)
  const turn = useMutation<Schemas['ClinicControllerPatientContracts'], ApiError, boolean>({
    mutationFn: (value) => unwrap(api.PUT('/api/clinic/patient-contracts', { body: { patientContracts: value } })),
    onSuccess: (saved) => {
      client.setQueryData<Me>(['me'], (old) => old?.clinic ? { ...old, clinic: { ...old.clinic, patientContracts: Boolean(saved.patientContracts) } } : old)
      void client.invalidateQueries({ queryKey: ['me'] })
    },
  })
  const shown = turn.isPending ? Boolean(turn.variables) : on
  return (
    <section className="card-block contract-offer" aria-label="Кому предлагать договор">
      <label className="check">
        <input type="checkbox" checked={shown} disabled={turn.isPending} onChange={(e) => turn.mutate(e.target.checked)} />
        {' '}<strong>Предлагать договор всем пациентам</strong>
      </label>
      <p className="hint small">
        Выключено — договор оформляется только по кнопке у нужного пациента (⋯ → Оформить договор). Включено — строка
        «📄 Договор» в карточке каждого пациента. Подписанный договор виден в карточке всегда.
      </p>
      {turn.error && <p className="error small" role="alert">{turn.error.message}</p>}
    </section>
  )
}

function Editor({ me, template }: { me: Me; template: Template }) {
  const client = useQueryClient()
  const [title, setTitle] = useState(template.title ?? '')
  const [body, setBody] = useState(template.body ?? '')
  const [requisites, setRequisites] = useState(template.requisites ?? '')
  const field = useRef<HTMLTextAreaElement>(null)
  const { dirty, commit } = useDirty({ title, body, requisites })
  const variables = template.variables ?? []
  const save = useMutation<Template, ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/clinic/contract-template', { body: { title, body, requisites } })),
    onSuccess: (saved) => {
      commit()
      client.setQueryData(['contract-template'], saved)
      void client.invalidateQueries({ queryKey: ['contract'] })
    },
  })
  const insert = (variable: string) => {
    const el = field.current
    const token = `{${variable}}`
    const start = el?.selectionStart ?? body.length
    const end = el?.selectionEnd ?? body.length
    save.reset()
    setBody(body.slice(0, start) + token + body.slice(end))
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(start + token.length, start + token.length)
    })
  }
  const unknown = [...unknownContractVariables(body, variables), ...unknownContractVariables(title, variables)]
  const clinic = me.clinic
  const doctor = (me.doctors ?? []).find((d) => d.active !== false)?.fullName ?? 'Айгерим Садыкова'
  const values = {
    'клиника': clinic?.brandName || clinic?.name,
    'юрлицо': clinic?.legalName || clinic?.brandName || clinic?.name,
    'адрес': clinic?.address,
    'реквизиты': requisites,
    'телефон клиники': clinic?.phones?.[0] ? formatPhone(clinic.phones[0]) : null,
    'пациент': SAMPLE.patient,
    'дата рождения': SAMPLE.birth,
    'телефон': SAMPLE.phone,
    'представитель': null,
    'дата': new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Bishkek', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date()),
    'врач': doctor,
  }
  const error = save.error && (Object.values(save.error.fieldErrors)[0] ?? save.error.message)
  const standard = body.trim() === (template.defaultBody ?? '').trim() && title.trim() === (template.defaultTitle ?? '').trim()

  return (
    <form className="form contract-template" aria-label="Шаблон договора с пациентом" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
      <section className="card-block">
        <p className="contract-legal" role="note">
          ⚖️ Это образец договора и информированного согласия на лечение, а не юридическая консультация. Проверьте текст у юриста
          и поправьте под свою клинику.
        </p>
        <p className="hint">
          Договор печатают из карточки пациента («⋯ → Оформить договор» или «Прочее → Договор») — данные пациента, клиники и врача подставятся сами. Пустое
          значение печатается линией — дописать от руки.
        </p>
        <label className="field"><span>Заголовок</span>
          <input value={title} maxLength={200} onChange={(e) => { save.reset(); setTitle(e.target.value) }} /></label>
        <label className="field"><span>Текст договора</span>
          <textarea ref={field} rows={18} value={body} maxLength={20000} aria-invalid={unknown.length > 0}
            onChange={(e) => { save.reset(); setBody(e.target.value) }} /></label>
        <div className="reminder-vars" role="group" aria-label="Вставить подстановку">
          {variables.map((v) => <button key={v} type="button" className="chip" onClick={() => insert(v)}>{`{${v}}`}</button>)}
        </div>
        {unknown.length > 0 && (
          <p className="error" role="alert">Неизвестная подстановка {unknown.join(', ')}. Можно: {variables.map((v) => `{${v}}`).join(', ')}.</p>
        )}
        <label className="field"><span>Реквизиты клиники — для {'{реквизиты}'}</span>
          <textarea rows={3} value={requisites} maxLength={1000} placeholder="ИНН, ОКПО, банк, расчётный счёт"
            onChange={(e) => { save.reset(); setRequisites(e.target.value) }} /></label>
        <div className="actions">
          <button type="button" className="btn" disabled={standard}
            onClick={() => { save.reset(); setTitle(template.defaultTitle ?? ''); setBody(template.defaultBody ?? '') }}>
            Вернуть шаблон по умолчанию</button>
        </div>
      </section>
      <section className="card-block" aria-label="Предпросмотр договора">
        <h2>Предпросмотр</h2>
        <p className="hint">Вымышленный пациент «{SAMPLE.patient}».</p>
        <article className="contract-preview">
          <h3>{fillContract(title, values)}</h3>
          <p>{fillContract(body, values)}</p>
        </article>
      </section>
      <SaveBar dirty={dirty} saving={save.isPending} saved={save.isSuccess} savedText="Шаблон договора сохранён"
        disabled={unknown.length > 0 || !body.trim()} error={error} />
    </form>
  )
}
