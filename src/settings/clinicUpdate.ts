import type { Schemas } from '../api/client'

type Clinic = Schemas['ClinicView']
type Request = Schemas['ClinicControllerRequest']

/**
 * PUT /api/clinic принимает «О клинике» целиком. Экраны, которые меняют одну часть (часы, режим
 * склада), берут остальное из текущей версии — так соседние поля не стираются.
 */
export function clinicRequest(c: Clinic, change: Partial<Request>): Request {
  return {
    brandName: c.brandName, legalName: c.legalName, address: c.address, whatsappPhone: c.whatsappPhone, mapUrl: c.mapUrl,
    supportTelegram: c.supportTelegram, supportPhone: c.supportPhone, workStart: c.workStart, workEnd: c.workEnd,
    workDays: c.workDays, independentDoctors: c.independentDoctors, listed: c.listed, separateSupplies: c.separateSupplies,
    ...change,
  }
}
