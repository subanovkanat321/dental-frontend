import * as THREE from 'three'

/**
 * Постобработка кадра «как снято камерой», чтобы не было стерильной компьютерной графики:
 *
 * - глубина резкости (DOF): сцена рисуется в текстуру вместе с глубиной; для каждого пикселя — «кружок
 *   рассеяния» по расстоянию до плоскости фокуса (рабочая зона) плюс лёгкое размытие к краям кадра
 *   (соседние зубы стоят почти на той же глубине — у макрообъектива их размывает кривизна поля);
 *   размытие — сбор 48 точек по спирали «золотого угла», точки резче центра весят меньше (не «ореолят»);
 * - тональная кривая и sRGB — здесь, а не в материалах (в текстуру пишем линейный HDR);
 * - виньетирование и тонкое зерно (своё на каждый кадр, детерминированное — номер кадра).
 */
export interface PostParams {
  /** Расстояние от камеры до плоскости фокуса. */
  focus: number
  /** Сила размытия по глубине (пикселей на единицу относительной расфокусировки). */
  aperture: number
  /** Размытие у краёв кадра, пикселей. */
  edgeBlur: number
  vignette: number
  grain: number
  frame: number
}

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`

const FRAG = /* glsl */ `
#include <common>
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 resolution;
uniform float cameraNear;
uniform float cameraFar;
uniform float focus;
uniform float aperture;
uniform float edgeBlur;
uniform float vignette;
uniform float grain;
uniform float frame;
varying vec2 vUv;

float viewZ(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  float z = d * 2.0 - 1.0;
  return 2.0 * cameraNear * cameraFar / (cameraFar + cameraNear - z * (cameraFar - cameraNear));
}
float coc(vec2 uv) {
  float z = viewZ(uv);
  float c = abs(z - focus) / z * aperture;
  vec2 q = (uv - 0.5) * vec2(1.0, 1.25);
  c += edgeBlur * smoothstep(0.22, 0.62, length(q));
  return min(c, 22.0);
}
float grainRand(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + frame * 0.618) * 43758.5453); }

void main() {
  float c0 = coc(vUv);
  vec3 sum = texture2D(tColor, vUv).rgb;
  float wsum = 1.0;
  if (c0 > 0.6) {
    const float GA = 2.39996323;
    for (int i = 1; i < 48; i++) {
      float fi = float(i);
      float r = sqrt(fi / 48.0) * c0;
      vec2 off = vec2(cos(fi * GA), sin(fi * GA)) * r / resolution;
      vec2 uv = vUv + off;
      float cs = coc(uv);
      // Точка влияет, только если её собственный кружок дотягивается сюда — резкое не расползается
      float w = smoothstep(r - 1.5, r + 0.5, cs);
      sum += texture2D(tColor, uv).rgb * w;
      wsum += w;
    }
  }
  vec4 col = vec4(sum / wsum, 1.0);
  gl_FragColor = col;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  // Виньетка (мягко темнеют углы) и зерно — уже в sRGB, как у плёнки/сенсора
  vec2 q = vUv - 0.5;
  float v = 1.0 - vignette * smoothstep(0.25, 0.85, length(q * vec2(1.0, 0.75)) * 1.25);
  gl_FragColor.rgb *= v;
  float n = grainRand(vUv * resolution) + grainRand(vUv * resolution + 17.0) - 1.0;
  gl_FragColor.rgb += n * grain * (0.6 + 0.4 * (1.0 - dot(gl_FragColor.rgb, vec3(0.333))));
}
`

export function createPost(renderer: THREE.WebGLRenderer, W: number, H: number) {
  const depth = new THREE.DepthTexture(W, H)
  depth.type = THREE.FloatType
  const target = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: 4, depthTexture: depth })
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      tColor: { value: target.texture },
      tDepth: { value: depth },
      resolution: { value: new THREE.Vector2(W, H) },
      cameraNear: { value: 0.05 },
      cameraFar: { value: 60 },
      focus: { value: 5 },
      aperture: { value: 0 },
      edgeBlur: { value: 0 },
      vignette: { value: 0.35 },
      grain: { value: 0.03 },
      frame: { value: 0 },
    },
    depthTest: false,
    depthWrite: false,
  })
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat)
  quad.frustumCulled = false
  const postScene = new THREE.Scene()
  postScene.add(quad)
  const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

  return {
    target,
    /** Вывести собранный в target кадр на экран с размытием, тоном, виньеткой и зерном. */
    finish(camera: THREE.PerspectiveCamera, p: PostParams) {
      const u = mat.uniforms
      u.cameraNear!.value = camera.near
      u.cameraFar!.value = camera.far
      u.focus!.value = p.focus
      u.aperture!.value = p.aperture
      u.edgeBlur!.value = p.edgeBlur
      u.vignette!.value = p.vignette
      u.grain!.value = p.grain
      u.frame!.value = p.frame
      renderer.setRenderTarget(null)
      renderer.render(postScene, postCam)
    },
  }
}
