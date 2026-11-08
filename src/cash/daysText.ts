/** «20 из 22 дней»: склонение «день / дня / дней» по последнему числу. */
export function daysText(n: number): string {
  const last = n % 10
  const teen = n % 100 >= 11 && n % 100 <= 14
  return teen || last === 0 || last >= 5 ? 'дней' : last === 1 ? 'день' : 'дня'
}
