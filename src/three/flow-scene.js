/**
 * Flow scene — "satu alur": one smooth 3D curve with six stage nodes and a
 * light stream of particles travelling along it. Used behind the landing hero.
 *
 * mountFlowScene(container, { highlight }) -> Promise<cleanup>
 * - three.js is loaded with a dynamic import so it is code-split.
 * - Transparent canvas; colours come from CSS tokens and follow 'themechange'.
 * - Renders only while visible and the tab is active; reduced motion renders
 *   one static frame. Fails silently (returns a no-op) without WebGL.
 */
import { cssVar } from '../ui/theme.js'
import { prefersReducedMotion } from '../ui/reveal.js'

const NOOP = () => {}
const STAGE_T = [0.2, 0.34, 0.47, 0.6, 0.73, 0.86]
const PARTICLES = 220
const LUT_SIZE = 600

function webglAvailable() {
  try {
    const c = document.createElement('canvas')
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')))
  } catch {
    return false
  }
}

export async function mountFlowScene(container, opts = {}) {
  if (!container || !webglAvailable()) return NOOP

  let T
  try {
    // Destructured directly so Rollup can tree-shake the dynamic import.
    const {
      WebGLRenderer, Scene, PerspectiveCamera, Vector3, Color, Group,
      CatmullRomCurve3, TubeGeometry, MeshBasicMaterial, Mesh, SphereGeometry,
      TorusGeometry, BufferGeometry, BufferAttribute, Points, PointsMaterial,
      Line, LineBasicMaterial,
    } = await import('three')
    T = {
      WebGLRenderer, Scene, PerspectiveCamera, Vector3, Color, Group,
      CatmullRomCurve3, TubeGeometry, MeshBasicMaterial, Mesh, SphereGeometry,
      TorusGeometry, BufferGeometry, BufferAttribute, Points, PointsMaterial,
      Line, LineBasicMaterial,
    }
  } catch {
    return NOOP
  }
  if (!container.isConnected) return NOOP

  const {
    WebGLRenderer, Scene, PerspectiveCamera, Vector3, Color, Group,
    CatmullRomCurve3, TubeGeometry, MeshBasicMaterial, Mesh, SphereGeometry,
    TorusGeometry, BufferGeometry, BufferAttribute, Points, PointsMaterial,
    Line, LineBasicMaterial,
  } = T

  let renderer
  try {
    renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
  } catch {
    return NOOP
  }

  const reduced = prefersReducedMotion()
  const highlight = Number.isInteger(opts.highlight) ? opts.highlight : 1

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75))
  renderer.setClearColor(0x000000, 0)
  const canvas = renderer.domElement
  canvas.setAttribute('aria-hidden', 'true')
  canvas.className = 'flow-canvas'
  container.appendChild(canvas)

  const scene = new Scene()
  const camera = new PerspectiveCamera(32, 1, 0.1, 100)
  camera.position.set(0, 0, 16)
  const world = new Group()
  scene.add(world)

  // ---- The flow: a gentle S ribbon ----
  // A descending S that keeps to the right of the hero headline.
  const curve = new CatmullRomCurve3([
    new Vector3(-7.6, 4.3, -1.0),
    new Vector3(-2.2, 4.6, 0.6),
    new Vector3(2.4, 4.1, 0.9),
    new Vector3(4.7, 2.4, 0.2),
    new Vector3(3.2, 0.5, -0.7),
    new Vector3(0.7, -0.8, 0.5),
    new Vector3(0.9, -2.7, 0.3),
    new Vector3(3.9, -3.6, -0.5),
    new Vector3(7.8, -4.1, 0.4),
], false, 'centripetal')

  const disposables = []
  const track = (x) => { disposables.push(x); return x }

  const inkMat = track(new MeshBasicMaterial())
  const tube = new Mesh(track(new TubeGeometry(curve, 480, 0.036, 8, false)), inkMat)
  world.add(tube)

  // Two faint echo lines give the ribbon depth without adding noise.
  const echoMat = track(new LineBasicMaterial({ transparent: true, opacity: 0.22 }))
  const basePts = curve.getSpacedPoints(300)
  ;[[0.24, 0.26, 0.2], [-0.22, -0.24, -0.25]].forEach(([dx, dy, dz]) => {
    const g = track(new BufferGeometry().setFromPoints(basePts.map((p, i) => {
      const k = Math.sin((i / 300) * Math.PI)
      return new Vector3(p.x + dx * k, p.y + dy * k, p.z + dz * k)
    })))
    world.add(new Line(g, echoMat))
  })

  // ---- Six stage nodes ----
  const nodeGeo = track(new SphereGeometry(0.19, 24, 16))
  const ringGeo = track(new TorusGeometry(0.33, 0.034, 8, 48))
  const haloGeo = track(new TorusGeometry(0.5, 0.018, 6, 64))
  const paperMat = track(new MeshBasicMaterial())
  const signalMat = track(new MeshBasicMaterial())
  const haloMat = track(new MeshBasicMaterial({ transparent: true, opacity: 0.8 }))
  let halo = null
  STAGE_T.forEach((t, i) => {
    const p = curve.getPointAt(t)
    const node = new Mesh(nodeGeo, i === highlight ? signalMat : paperMat)
    node.position.copy(p)
    const ring = new Mesh(ringGeo, inkMat)
    ring.position.copy(p)
    world.add(node, ring)
    if (i === highlight) {
      halo = new Mesh(haloGeo, haloMat)
      halo.position.copy(p)
      world.add(halo)
    }
  })

  // ---- Particles travelling along the curve ----
  const lut = curve.getSpacedPoints(LUT_SIZE)
  const seeds = new Float32Array(PARTICLES * 4) // t0, speed, offsetY, offsetZ
  for (let i = 0; i < PARTICLES; i++) {
    seeds[i * 4] = Math.random()
    seeds[i * 4 + 1] = 0.012 + Math.random() * 0.02
    const r = Math.pow(Math.random(), 1.6) * 0.42
    const a = Math.random() * Math.PI * 2
    seeds[i * 4 + 2] = Math.cos(a) * r
    seeds[i * 4 + 3] = Math.sin(a) * r
  }
  const positions = new Float32Array(PARTICLES * 3)
  const colors = new Float32Array(PARTICLES * 3)
  const pGeo = track(new BufferGeometry())
  pGeo.setAttribute('position', new BufferAttribute(positions, 3))
  pGeo.setAttribute('color', new BufferAttribute(colors, 3))
  const pMat = track(new PointsMaterial({ size: 3.2, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.9 }))
  world.add(new Points(pGeo, pMat))

  function placeParticles(time) {
    for (let i = 0; i < PARTICLES; i++) {
      const s = i * 4
      const t = (seeds[s] + time * seeds[s + 1]) % 1
      const f = t * LUT_SIZE
      const i0 = Math.floor(f)
      const i1 = Math.min(i0 + 1, LUT_SIZE)
      const k = f - i0
      const a = lut[i0]
      const b = lut[i1]
      const fade = Math.sin(t * Math.PI) // thin out at both ends
      positions[i * 3] = a.x + (b.x - a.x) * k
      positions[i * 3 + 1] = a.y + (b.y - a.y) * k + seeds[s + 2] * fade
      positions[i * 3 + 2] = a.z + (b.z - a.z) * k + seeds[s + 3] * fade
    }
    pGeo.attributes.position.needsUpdate = true
  }

  // ---- Colours from tokens ----
  const parse = (name, fallback) => {
    const c = new Color()
    try { c.setStyle(cssVar(name) || fallback) } catch { c.setStyle(fallback) }
    return c
  }
  function applyColors() {
    const ink = parse('--ink', '#16150f')
    const paper = parse('--paper', '#f3efe6')
    const signal = parse('--signal', '#c6f24e')
    inkMat.color.copy(ink)
    echoMat.color.copy(ink)
    paperMat.color.copy(paper)
    signalMat.color.copy(signal)
    haloMat.color.copy(ink)
    for (let i = 0; i < PARTICLES; i++) {
      const c = i % 11 === 0 ? signal : ink
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b
    }
    pGeo.attributes.color.needsUpdate = true
  }
  applyColors()

  // ---- Sizing: keep the whole curve in frame for any aspect ratio ----
  function resize() {
    const w = Math.max(1, container.clientWidth)
    const h = Math.max(1, container.clientHeight)
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    const tanHalf = Math.tan((camera.fov * Math.PI) / 360)
    const distW = 5.9 / (tanHalf * camera.aspect)
    const distH = 5.3 / tanHalf
    baseZ = Math.min(Math.max(distW, distH, 12), 40)
    camera.updateProjectionMatrix()
  }
  let baseZ = 16

  // ---- Loop ----
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 }
  let raf = 0
  let visible = true
  let start = performance.now()
  let elapsed = 0

  function frame(time) {
    pointer.x += (pointer.tx - pointer.x) * 0.04
    pointer.y += (pointer.ty - pointer.y) * 0.04
    camera.position.x = Math.sin(time * 0.06) * 0.7 + pointer.x * 0.9
    camera.position.y = Math.cos(time * 0.045) * 0.35 - pointer.y * 0.5
    camera.position.z = baseZ
    camera.lookAt(0, 0, 0)
    world.rotation.y = Math.sin(time * 0.05) * 0.06
    if (halo) {
      const s = 1 + ((time * 0.6) % 1) * 0.9
      halo.scale.setScalar(s)
      haloMat.opacity = 0.75 * (1 - ((time * 0.6) % 1))
      halo.lookAt(camera.position)
    }
    placeParticles(time)
    renderer.render(scene, camera)
  }

  function renderStatic() {
    if (halo) { halo.scale.setScalar(1.15); haloMat.opacity = 0.5 }
    pointer.x = pointer.y = 0
    camera.position.set(0, 0, baseZ)
    camera.lookAt(0, 0, 0)
    placeParticles(4)
    renderer.render(scene, camera)
  }

  const tick = (now) => {
    raf = 0
    elapsed = (now - start) / 1000
    frame(elapsed)
    if (shouldRun()) raf = requestAnimationFrame(tick)
  }
  const shouldRun = () => !reduced && visible && !document.hidden
  function play() {
    if (raf || !shouldRun()) return
    start = performance.now() - elapsed * 1000
    raf = requestAnimationFrame(tick)
  }
  function stop() {
    if (raf) cancelAnimationFrame(raf)
    raf = 0
  }

  resize()
  if (reduced) renderStatic()
  else frame(0)
  container.classList.add('is-ready')

  const ro = new ResizeObserver(() => {
    resize()
    if (reduced) renderStatic()
    else if (!raf) frame(elapsed)
  })
  ro.observe(container)

  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting
    if (visible) play()
    else stop()
  }, { threshold: 0 })
  io.observe(container)

  const onVisibility = () => (document.hidden ? stop() : play())
  document.addEventListener('visibilitychange', onVisibility)

  const onTheme = () => {
    applyColors()
    if (reduced) renderStatic()
    else if (!raf) frame(elapsed)
  }
  window.addEventListener('themechange', onTheme)

  const onPointer = (e) => {
    pointer.tx = (e.clientX / window.innerWidth) * 2 - 1
    pointer.ty = (e.clientY / window.innerHeight) * 2 - 1
  }
  if (!reduced) window.addEventListener('pointermove', onPointer, { passive: true })

  play()

  return function cleanup() {
    stop()
    ro.disconnect()
    io.disconnect()
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('themechange', onTheme)
    window.removeEventListener('pointermove', onPointer)
    disposables.forEach((d) => d.dispose())
    renderer.dispose()
    canvas.remove()
    container.classList.remove('is-ready')
  }
}
