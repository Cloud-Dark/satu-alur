/**
 * Growth scene — "tumbuh dalam satu alur" in clay. Six rounded pillars (the six
 * stages) rise step by step on a soft plinth, joined by one thin flow line
 * across their tops. A turmeric seed hops from stage to stage; each pillar
 * glows softly as it lands. Matte materials, soft lights, transparent
 * background. Used in the landing hero.
 *
 * mountFlowScene(container, { highlight }) -> Promise<cleanup>
 * - three.js is code-split with a dynamic import, destructured by name so
 *   Rollup can tree-shake it.
 * - Colours come from CSS tokens and follow 'themechange'.
 * - Pixel ratio <= 1.75; renders only while visible and the tab is active;
 *   reduced motion renders a single static frame. Without WebGL it returns a
 *   no-op and the container keeps its CSS/SVG fallback.
 */
import { cssVar } from '../ui/theme.js'
import { prefersReducedMotion } from '../ui/reveal.js'

const NOOP = () => {}
const STEPS = 6
const HEIGHTS = [0.9, 1.45, 2.05, 2.7, 3.4, 4.2]
const PILLAR = 1.05 // footprint of each pillar
const HOP = 0.85 // seconds per hop
const REST = 0.55 // pause on each pillar
const SEED_R = 0.3

function webglAvailable() {
  try {
    const c = document.createElement('canvas')
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')))
  } catch {
    return false
  }
}

async function loadThree() {
  // Named destructuring keeps the dynamic import tree-shakeable.
  const {
    WebGLRenderer, Scene, PerspectiveCamera, Vector3, Color, Group, Shape, ExtrudeGeometry,
    CatmullRomCurve3, Mesh, SphereGeometry, TubeGeometry, CylinderGeometry, TorusGeometry,
    MeshStandardMaterial, MeshPhysicalMaterial, HemisphereLight, DirectionalLight,
  } = await import('three')
  return {
    WebGLRenderer, Scene, PerspectiveCamera, Vector3, Color, Group, Shape, ExtrudeGeometry,
    CatmullRomCurve3, Mesh, SphereGeometry, TubeGeometry, CylinderGeometry, TorusGeometry,
    MeshStandardMaterial, MeshPhysicalMaterial, HemisphereLight, DirectionalLight,
  }
}

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

export async function mountFlowScene(container, opts = {}) {
  if (!container || !webglAvailable()) return NOOP

  let T
  try {
    T = await loadThree()
  } catch {
    return NOOP
  }
  if (!container.isConnected) return NOOP

  const {
    WebGLRenderer, Scene, PerspectiveCamera, Vector3, Color, Group,
    CatmullRomCurve3, Mesh, SphereGeometry, TubeGeometry, CylinderGeometry, TorusGeometry,
    MeshStandardMaterial, MeshPhysicalMaterial, HemisphereLight, DirectionalLight, Shape, ExtrudeGeometry,
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
  const camera = new PerspectiveCamera(28, 1, 0.1, 100)
  const world = new Group()
  scene.add(world)

  const disposables = []
  const track = (x) => { disposables.push(x); return x }

  // ---- Lights: soft sky/ground fill + a warm key and a cool rim ----
  const hemi = new HemisphereLight(0xffffff, 0xdcebe3, 1.7)
  const key = new DirectionalLight(0xfff4e2, 2.6)
  key.position.set(-5, 9, 7)
  const rim = new DirectionalLight(0xffffff, 0.8)
  rim.position.set(7, 3, -6)
  scene.add(hemi, key, rim)

  // ---- Layout: pillars on a gentle arc, rising left to right ----
  const positions = HEIGHTS.map((h, i) => {
    const t = i / (STEPS - 1)
    const x = -3.4 + t * 6.8
    const z = Math.sin(t * Math.PI) * -1.3 + 0.6
    return new Vector3(x, 0, z)
  })
  const topOf = (i) => new Vector3(positions[i].x, HEIGHTS[i] + SEED_R, positions[i].z)

  // Plinth: a soft, wide disc the composition stands on.
  const plinthMat = track(new MeshStandardMaterial({ roughness: 0.9 }))
  const plinth = new Mesh(track(new CylinderGeometry(5.1, 5.25, 0.32, 96, 1)), plinthMat)
  plinth.scale.set(1, 1, 0.62)
  plinth.position.set(0, -0.16, -0.2)
  world.add(plinth)

  // Pillars: rounded clay blocks (a rounded square extruded upward with a soft bevel).
  const BEVEL = 0.14
  function pillarGeometry(h) {
    const a = PILLAR / 2 - BEVEL
    const r = 0.16
    const sh = new Shape()
    sh.moveTo(-a + r, -a)
    sh.lineTo(a - r, -a)
    sh.quadraticCurveTo(a, -a, a, -a + r)
    sh.lineTo(a, a - r)
    sh.quadraticCurveTo(a, a, a - r, a)
    sh.lineTo(-a + r, a)
    sh.quadraticCurveTo(-a, a, -a, a - r)
    sh.lineTo(-a, -a + r)
    sh.quadraticCurveTo(-a, -a, -a + r, -a)
    const g = new ExtrudeGeometry(sh, {
      depth: Math.max(0.01, h - BEVEL * 2),
      bevelEnabled: true,
      bevelThickness: BEVEL,
      bevelSize: BEVEL,
      bevelSegments: 5,
      curveSegments: 10,
    })
    g.rotateX(-Math.PI / 2)
    g.translate(0, BEVEL - h / 2, 0)
    g.computeVertexNormals()
    return g
  }
  const pillarMats = HEIGHTS.map(() => track(new MeshPhysicalMaterial({ roughness: 0.62, clearcoat: 0.2, clearcoatRoughness: 0.7, sheen: 0.35, sheenRoughness: 0.8 })))
  const pillars = HEIGHTS.map((h, i) => {
    const g = track(pillarGeometry(h))
    const m = new Mesh(g, pillarMats[i])
    m.position.set(positions[i].x, h / 2, positions[i].z)
    m.userData = { glow: 0 }
    world.add(m)
    return m
  })

  // The flow: one thin line running across the pillar tops.
  const flowPts = []
  flowPts.push(new Vector3(positions[0].x - 1.0, HEIGHTS[0] * 0.55, positions[0].z + 0.4))
  positions.forEach((p, i) => flowPts.push(new Vector3(p.x, HEIGHTS[i] + 0.05, p.z)))
  flowPts.push(new Vector3(positions[STEPS - 1].x + 0.9, HEIGHTS[STEPS - 1] + 0.9, positions[STEPS - 1].z - 0.3))
  const flowCurve = new CatmullRomCurve3(flowPts, false, 'centripetal')
  const flowMat = track(new MeshStandardMaterial({ roughness: 0.5 }))
  world.add(new Mesh(track(new TubeGeometry(flowCurve, 220, 0.045, 10, false)), flowMat))

  // Stage markers: small rings on each pillar top.
  const ringGeo = track(new TorusGeometry(0.27, 0.035, 10, 48))
  const ringMat = track(new MeshStandardMaterial({ roughness: 0.4 }))
  pillars.forEach((p, i) => {
    const r = new Mesh(ringGeo, ringMat)
    r.rotation.x = Math.PI / 2
    r.position.set(positions[i].x, HEIGHTS[i] + 0.02, positions[i].z)
    world.add(r)
  })

  // The seed that hops from stage to stage.
  const seedMat = track(new MeshPhysicalMaterial({ roughness: 0.4, clearcoat: 0.7, clearcoatRoughness: 0.25 }))
  const seed = new Mesh(track(new SphereGeometry(SEED_R, 48, 32)), seedMat)
  world.add(seed)

  // A few floating pearls for depth.
  const pearlMat = track(new MeshPhysicalMaterial({ roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.3 }))
  const pearlGeo = track(new SphereGeometry(1, 32, 24))
  const pearls = [
    { p: new Vector3(-3.6, 3.4, -1.6), s: 0.26, ph: 0 },
    { p: new Vector3(-1.2, 4.6, -2.4), s: 0.16, ph: 1.7 },
    { p: new Vector3(1.6, 5.3, -1.8), s: 0.2, ph: 3.1 },
    { p: new Vector3(4.6, 1.6, 0.9), s: 0.14, ph: 4.4 },
  ].map(({ p, s, ph }) => {
    const m = new Mesh(pearlGeo, pearlMat)
    m.scale.setScalar(s)
    m.position.copy(p)
    m.userData = { base: p.clone(), ph }
    world.add(m)
    return m
  })

  // ---- Colours from tokens ----
  const parse = (name, fallback) => {
    const c = new Color()
    try { c.setStyle(cssVar(name) || fallback) } catch { c.setStyle(fallback) }
    return c
  }
  const pillarBase = []
  const accent = new Color()
  function applyColors() {
    const dark = document.documentElement.dataset.theme === 'dark'
    const light = dark ? parse('--brand-300', '#3f7d66') : parse('--brand-300', '#8fbfab')
    const deep = dark ? parse('--brand-500', '#6fbb98') : parse('--brand', '#134235')
    pillarBase.length = 0
    pillarMats.forEach((m, i) => {
      const c = light.clone().lerp(deep, i / (STEPS - 1))
      pillarBase.push(c)
      m.color.copy(c)
      m.sheenColor.copy(parse('--brand-100', '#dcebe3'))
    })
    accent.copy(parse('--accent', '#e7a13a'))
    seedMat.color.copy(accent)
    seedMat.emissive.copy(accent).multiplyScalar(dark ? 0.2 : 0.08)
    plinthMat.color.copy(dark ? parse('--surface-2', '#17241f') : parse('--surface', '#ffffff'))
    flowMat.color.copy(dark ? parse('--brand-600', '#a6dcc3') : parse('--brand-500', '#2b7560'))
    ringMat.color.copy(dark ? parse('--text', '#e9efeb') : parse('--surface', '#ffffff'))
    pearlMat.color.copy(dark ? parse('--text-2', '#c9d4ce') : parse('--surface', '#ffffff'))
    hemi.color.set(dark ? 0xdfeee6 : 0xffffff)
    hemi.groundColor.copy(parse('--brand-100', '#dcebe3'))
    hemi.intensity = dark ? 1.2 : 1.8
    key.intensity = dark ? 2.3 : 2.7
  }
  applyColors()

  // ---- Seed choreography ----
  const cycle = STEPS * (HOP + REST) + 0.6
  const tmpA = new Vector3()
  const tmpB = new Vector3()
  function placeSeed(time) {
    const t = time % cycle
    const slot = Math.floor(t / (HOP + REST))
    const local = t - slot * (HOP + REST)
    pillars.forEach((p) => { p.userData.glow *= 0.94 })
    if (slot >= STEPS) {
      // Fade out above the last pillar, then restart at the first.
      const k = Math.min(1, (t - STEPS * (HOP + REST)) / 0.6)
      seed.position.copy(topOf(STEPS - 1)).add(tmpA.set(0, k * 0.8, 0))
      seed.scale.setScalar(Math.max(0.001, 1 - k))
      return
    }
    seed.scale.setScalar(1)
    if (slot === 0 && local < HOP) {
      // Grow in on the first pillar.
      const k = easeInOut(local / HOP)
      seed.position.copy(topOf(0)).add(tmpA.set(0, (1 - k) * 0.6, 0))
      seed.scale.setScalar(Math.max(0.001, k))
      if (k > 0.95) pillars[0].userData.glow = 1
      return
    }
    if (local < HOP && slot > 0) {
      const k = easeInOut(local / HOP)
      tmpA.copy(topOf(slot - 1))
      tmpB.copy(topOf(slot))
      seed.position.lerpVectors(tmpA, tmpB, k)
      seed.position.y += Math.sin(k * Math.PI) * 1.1
      seed.scale.set(1 - Math.sin(k * Math.PI) * 0.06, 1 + Math.sin(k * Math.PI) * 0.08, 1 - Math.sin(k * Math.PI) * 0.06)
      if (k > 0.97) pillars[slot].userData.glow = 1
    } else {
      // Resting: a small squash on landing.
      const r = (local - HOP) / REST
      const squash = Math.max(0, 1 - r * 3) * 0.12
      seed.position.copy(topOf(slot))
      seed.position.y -= squash * SEED_R
      seed.scale.set(1 + squash, 1 - squash, 1 + squash)
    }
  }
  function applyGlow() {
    pillarMats.forEach((m, i) => {
      const g = pillars[i].userData.glow
      m.color.copy(pillarBase[i]).lerp(accent, g * 0.22)
      m.emissive.copy(accent).multiplyScalar(g * 0.1)
    })
  }

  // ---- Sizing: keep the whole composition in frame for any aspect ratio ----
  let dist = 18
  function resize() {
    const w = Math.max(1, container.clientWidth)
    const h = Math.max(1, container.clientHeight)
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    const tanHalf = Math.tan((camera.fov * Math.PI) / 360)
    const halfW = 6.6
    const halfH = 5.0
    dist = Math.min(Math.max(halfW / (tanHalf * camera.aspect), halfH / tanHalf, 10), 44)
    camera.updateProjectionMatrix()
  }

  // ---- Loop ----
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 }
  let raf = 0
  let visible = true
  let start = performance.now()
  let elapsed = 0
  const target = new Vector3(0.5, -0.9, 0)

  function pose(time, px, py) {
    world.rotation.y = -0.22 + Math.sin(time * 0.18) * 0.08 + px * 0.14
    world.position.y = Math.sin(time * 0.45) * 0.06
    pearls.forEach((m) => {
      const { base, ph } = m.userData
      m.position.set(base.x, base.y + Math.sin(time * 0.9 + ph) * 0.18, base.z)
    })
    const elev = 0.32 - py * 0.06
    camera.position.set(Math.sin(px * 0.1) * dist, target.y + Math.sin(elev) * dist, Math.cos(elev) * dist)
    camera.lookAt(target)
  }

  function frame(time) {
    pointer.x += (pointer.tx - pointer.x) * 0.045
    pointer.y += (pointer.ty - pointer.y) * 0.045
    pose(time, pointer.x, pointer.y)
    placeSeed(time)
    applyGlow()
    renderer.render(scene, camera)
  }

  function renderStatic() {
    pose(0, 0, 0)
    seed.position.copy(topOf(highlight))
    seed.scale.setScalar(1)
    pillars.forEach((p, i) => { p.userData.glow = i === highlight ? 0.8 : 0 })
    applyGlow()
    renderer.render(scene, camera)
  }

  const shouldRun = () => !reduced && visible && !document.hidden
  const tick = (now) => {
    raf = 0
    elapsed = Math.max(0, (now - start) / 1000)
    frame(elapsed)
    if (shouldRun()) raf = requestAnimationFrame(tick)
  }
  function play() {
    if (raf || !shouldRun()) return
    start = performance.now() - elapsed * 1000
    raf = requestAnimationFrame(tick)
  }
  function stop() {
    if (raf) cancelAnimationFrame(raf)
    raf = 0
  }
  const redraw = () => {
    if (reduced) renderStatic()
    else if (!raf) frame(elapsed)
  }

  resize()
  redraw()
  container.classList.add('is-ready')

  const ro = new ResizeObserver(() => { resize(); redraw() })
  ro.observe(container)

  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting
    if (visible) play()
    else stop()
  }, { threshold: 0 })
  io.observe(container)

  const onVisibility = () => (document.hidden ? stop() : play())
  document.addEventListener('visibilitychange', onVisibility)

  const onTheme = () => { applyColors(); redraw() }
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
