import { imageSize, type GuideImage } from './content'

/**
 * Картинка руководства с подписью — одна для сайта (/guide) и книги в CRM («Помощь → Руководство»). Не шире своего
 * размера: маленький снимок кнопки не растягивается на всю колонку; снимок телефона (×2) — в половину своих пикселей.
 */
export function Figure({ image, eager = false }: { image: GuideImage; eager?: boolean }) {
  const size = imageSize(image.src)
  const maxWidth = size.width ? size.width / (image.phone ? 2 : 1) : undefined
  const url = `${import.meta.env.BASE_URL}guide/${image.src}`
  return (
    <figure className={image.phone ? 'manual-figure phone' : 'manual-figure'} style={{ maxWidth }}>
      {/* Нажать — картинка целиком в новой вкладке: на телефоне снимок компьютера мелкий */}
      <a href={url} target="_blank" rel="noopener noreferrer">
        <img src={url} alt={image.alt} loading={eager ? 'eager' : 'lazy'} decoding="async" {...size} />
      </a>
      <figcaption>{image.caption}</figcaption>
    </figure>
  )
}
