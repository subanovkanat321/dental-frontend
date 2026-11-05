/**
 * Есть ли WebGL (3D в браузере). Старые компьютеры клиник, выключенное аппаратное ускорение,
 * «облегчённые» браузеры — тогда показываем схему вместо 3D, а не пустой чёрный экран.
 */
export function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
    if (!gl) return false
    // Сразу отдать контекст: у браузера их лимит
    ;(gl as WebGLRenderingContext).getExtension('WEBGL_lose_context')?.loseContext()
    return true
  } catch {
    return false
  }
}
