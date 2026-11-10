import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { api, ApiError, unwrap, webTariffs, type Schemas } from '../api/client'
import { SaveBar } from '../layout/SaveBar'
import { somText } from '../lib/time'
import { useDirty } from '../lib/unsaved'
import { Loading } from '../layout/Loading'
import { HeadTools } from '../layout/PageHead'
import { HelpHint } from '../help/HelpHint'

type Tariffs = Schemas['Tariffs']
type Tariff = Schemas['TariffsTariff']
type Row = { code: string; name: string; who: string; maxDoctors: string; monthSom: string; yearSom: string }

const toRow = (t: Tariff): Row => ({
  code: t.code ?? '', name: t.name ?? '', who: t.who ?? '', maxDoctors: t.maxDoctors != null ? String(t.maxDoctors) : '',
  monthSom: String(t.monthSom ?? ''), yearSom: String(t.yearSom ?? ''),
})

/**
 * «Тарифы» — владелец платформы меняет цены, подписи и сколько врачей в тарифе. Сохранили — сразу
 * везде: «Тариф и оплата» у клиник, страница /join, счета. Последний тариф — без предела врачей.
 * «За год» по умолчанию — 10 месяцев; можно поставить свою.
 */
export function TariffsTab() {
  const loaded = useQuery({ queryKey: ['tariffs'], queryFn: webTariffs })
  if (loaded.isPending) return <Loading />
  if (!loaded.data) return <p className="error">Тарифы не загрузились — обновите страницу.</p>
  // Без key из цен: после «Сохранить» ответ с новыми ценами пересоздал бы форму — и пропало бы «Тарифы сохранены».
  // В форме и так ровно то, что сохранили.
  return <TariffsForm tariffs={loaded.data} />
}

function TariffsForm({ tariffs }: { tariffs: Tariffs }) {
  const client = useQueryClient()
  const [rows, setRows] = useState<Row[]>((tariffs.tariffs ?? []).map(toRow))
  const [pilot, setPilot] = useState(String(tariffs.pilotMonths ?? 0))
  const { dirty, commit } = useDirty({ rows, pilot })
  const save = useMutation<Tariffs, ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/platform/tariffs', {
      body: {
        pilotMonths: Number(pilot) || 0,
        tariffs: rows.map((r, i) => ({
          code: r.code, name: r.name.trim(), who: r.who.trim(),
          maxDoctors: i === rows.length - 1 ? undefined : Number(r.maxDoctors),
          monthSom: Number(r.monthSom), yearSom: Number(r.yearSom),
        })),
      },
    })),
    onSuccess: (fresh) => {
      commit()
      client.setQueryData(['tariffs'], fresh)
      // Те же цены видят «Настройки» платформы, «Тариф и оплата» клиники и /join
      for (const key of ['clinic-plan', 'web-tariffs']) void client.invalidateQueries({ queryKey: [key] })
    },
  })
  const set = (i: number, key: keyof Row, value: string) => {
    save.reset()
    setRows(rows.map((r, j) => {
      if (j !== i) return r
      const next = { ...r, [key]: value }
      // Год следует за месяцем (цена 10 месяцев), пока его не правили отдельно
      if (key === 'monthSom' && (r.yearSom === '' || Number(r.yearSom) === Number(r.monthSom) * 10)) next.yearSom = value ? String(Number(value) * 10) : ''
      return next
    }))
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate()
  }
  return (
    <form className="card-block tariffs-form" aria-label="Тарифы" onSubmit={submit}>
      <HeadTools>
        <HelpHint title="Тарифы">Сохраните — новые цены сразу у всех клиник в «Тариф и оплата», на странице для клиник и в счетах. Уже оплаченные сроки не меняются.</HelpHint>
      </HeadTools>
      {rows.map((r, i) => {
        const last = i === rows.length - 1
        return (
          <fieldset key={r.code} className="tariff-row">
            <legend>{r.name || r.code}</legend>
            <label className="field"><span>Название</span>
              <input value={r.name} maxLength={40} required onChange={(e) => set(i, 'name', e.target.value)} /></label>
            <label className="field"><span>Для кого (подпись)</span>
              <input value={r.who} maxLength={80} onChange={(e) => set(i, 'who', e.target.value)} /></label>
            <div className="row">
              <label className="field"><span>До скольких врачей</span>
                {last ? <input value="без ограничения" disabled aria-label={`Врачей: ${r.name}`} />
                  : <input type="number" min={1} inputMode="numeric" required aria-label={`Врачей: ${r.name}`} value={r.maxDoctors}
                    onChange={(e) => set(i, 'maxDoctors', e.target.value)} />}
              </label>
              <label className="field"><span>В месяц, сом</span>
                <input type="number" min={1} inputMode="numeric" required aria-label={`В месяц: ${r.name}`} value={r.monthSom}
                  onChange={(e) => set(i, 'monthSom', e.target.value)} /></label>
              <label className="field"><span>За год, сом</span>
                <input type="number" min={1} inputMode="numeric" required aria-label={`За год: ${r.name}`} value={r.yearSom}
                  onChange={(e) => set(i, 'yearSom', e.target.value)} /></label>
            </div>
            {Number(r.monthSom) > 0 && Number(r.yearSom) > 0 && (
              <p className="hint small">За год выходит {somText(Number(r.yearSom))} — как {(Number(r.yearSom) / Number(r.monthSom)).toFixed(1).replace('.0', '')} мес.</p>
            )}
          </fieldset>
        )
      })}
      <label className="field"><span>Бесплатных месяцев новым клиникам (акция; 0 — без акции)</span>
        <input type="number" min={0} max={24} inputMode="numeric" value={pilot} onChange={(e) => { save.reset(); setPilot(e.target.value) }} /></label>
      <SaveBar dirty={dirty} saving={save.isPending} saved={save.isSuccess} label="Сохранить тарифы" savedText="Тарифы сохранены — новые цены уже видят клиники"
        error={save.error && (Object.values(save.error.fieldErrors)[0] ?? save.error.message)} />
    </form>
  )
}
