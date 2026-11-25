import { sitePageFor } from '../../vite.config'

test('npm run dev: короткие адреса сайта открывают свои страницы, как nginx на проде', () => {
  expect(sitePageFor('/clinics')).toBe('/site/clinics.html')
  expect(sitePageFor('/clinics/')).toBe('/site/clinics.html')
  expect(sitePageFor('/c/demo-1')).toBe('/site/clinic.html')
  expect(sitePageFor('/learn/implant')).toBe('/site/learn.html')
  expect(sitePageFor('/r/abc')).toBe('/site/review.html')
  expect(sitePageFor('/pay/tok')).toBe('/site/pay.html')
  expect(sitePageFor('/about')).toBe('/site/about.html')
  // CRM, Mini App, картинки сайта и сами HTML сайта — как есть
  expect(sitePageFor('/')).toBeNull()
  expect(sitePageFor('/start')).toBeNull()
  expect(sitePageFor('/about/hero.png')).toBeNull()
  expect(sitePageFor('/site/clinic.html')).toBeNull()
  expect(sitePageFor('/api/patient/me')).toBeNull()
})
