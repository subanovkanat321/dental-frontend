import type { Schemas } from '../api/client'
import { colorOf } from '../lib/avatars'
import { isAssistant } from '../lib/roles'
import type { DoctorOption } from './DoctorFilter'

type Doctor = Schemas['DoctorView']
type Me = Schemas['BookingViewsMe']

/**
 * По какому списку красить врачей — тот же, что у «Расписания» (SchedulePage clinicDoctors): активные врачи клиники,
 * ассистенту — его врачи. Цвет — по месту в этом списке, поэтому у врача везде один цвет, что бы ни показывал фильтр.
 */
export function colorDoctorsOf(me: Me): Doctor[] {
  return (me.doctors ?? []).filter((d) => d.active !== false && (!isAssistant(me) || me.assistantOf!.includes(d.id)))
}

/** Врачи → пункты выбора: имя (свой — «(я)»), фото, цвет врача (как в «Расписании»), мелкая строка `sub`. */
export function doctorOptions(doctors: readonly Doctor[], { me, colorDoctors = me ? colorDoctorsOf(me) : doctors, sub }: {
  me?: Me
  colorDoctors?: readonly Doctor[]
  sub?: (d: Doctor, i: number) => string | undefined
} = {}): DoctorOption[] {
  return doctors.map((d, i) => ({
    id: d.id,
    name: `${d.fullName ?? ''}${me?.doctorId != null && d.id === me.doctorId ? ' (я)' : ''}`,
    photoUrl: d.photoUrl,
    color: colorOf(colorDoctors, d.id),
    sub: sub?.(d, i),
  }))
}
