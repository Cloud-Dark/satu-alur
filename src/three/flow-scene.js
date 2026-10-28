/**
 * Flow scene — "satu alur" in clay. A soft, flattened ribbon follows a gentle
 * S-curve; six pearl beads mark the stages (one in turmeric) and small seeds
 * glide along it. Matte materials, hemisphere + directional light, transparent
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
const STAGE_T = [0.075, 0.245, 0.415, 0.585, 0.755, 0.925]
const SEEDS = 72
const SEGMENTS = 360
const RADIAL = 28
const LUT = 720
const WIDTH = 0.46 // half-width of the ribbon
const THICK = 0.17 // half-thickness of the ribbon

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
    WebGLRenderer, Scene, PerspectiveCamera, Vector3, Color, Group, Object3D,
    CatmullRomCurve3, BufferGeometry, Float32BufferAttribute, Mesh, InstancedMesh,
    SphereGeometry, TubeGeometry, MeshStandardMaterial, MeshPhysicalMaterial,
    HemisphereLight, DirectionalLight, DynamicDrawUsage,
  } = await import('three')
  return {
    WebGLRenderer, Scene, PerspectiveCamera, Vector3, Color, Group, Object3D,
    CatmullRomCurve3, BufferGeometry, Float32BufferAttribute, Mesh, InstancedMesh,
    SphereGeometry, TubeGeometry, MeshStandardMaterial, MeshPhysicalMaterial,
    HemisphereLight, DirectionalLight, DynamicDrawUsage,
  }
}

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

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
    WebGLRenderer, Scene, PerspectiveCamera, Vector3, Color, Group, Object3D,
    CatmullRomCurve3, BufferGeometry, Float32BufferAttribute, Mesh, InstancedMesh,
    SphereGeometry, TubeGeometry, MeshStandardMaterial, MeshPhysicalMaterial,
    HemisphereLight, DirectionalLight, DynamicDrawUsage,
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
  const camera = new PerspectiveCamera(30, 1, 0.1, 100)
  camera.position.set(0, 0, 20)
  const world = new Group()
  scene.add(world)

  const disposables = []
  const track = (x) => { disposables.push(x); return x }

  // ---- Lights: soft sky/ground fill + a warm key and a cool rim ----
  const hemi = new HemisphereLight(0xffffff, 0xdcebe3, 1.6)
  const key = new DirectionalLight(0xfff4e2, 2.1)
  key.position.set(-4, 6, 8)
  const rim = new DirectionalLight(0xffffff, 0.7)
  rim.position.set(6, -2, -4)
  scene.add(hemi, key, rim)

  // ---- The flow: a gentle S, descending left-to-right ----
  const curve = new CatmullRomCurve3([
    new Vector3(-4.7, 3.3, -0.8),
    new Vector3(-2.2, 3.9, 0.3),
    new Vector3(1.2, 3.5, 0.7),
    new Vector3(3.0, 1.9, 0.2),
    new Vector3(1.4, 0.2, -0.5),
    new Vector3(-1.4, -0.4, 0.1),
    new Vector3(-2.6, -2.0, 0.6),
    new Vector3(-0.6, -3.5, 0.3),
    new Vector3(2.4, -3.8, -0.2),
    new Vector3(4.8, -3.0, -0.8),
  ], false, 'centripetal')

  // Sampled frames (parallel-transported, so no flips through the S bends).
  const frames = curve.computeFrenetFrames(LUT, false)
  const lutP = curve.getSpacedPoints(LUT)
  const twistAt = (t) => Math.sin(t * Math.PI * 2 + 0.4) * 0.32
  const taperAt = (t) => Math.max(0.03, Math.pow(smoothstep(0, 0.09, t) * smoothstep(1, 0.91, t), 0.7))

  // Build the ribbon: an elliptical cross-section swept along the curve,
  // gently twisting and tapering to a point at both ends (like a brushstroke).
  function ribbonGeometry() {
    const verts = []
    const norms = []
    const index = []
    const P = new Vector3()
    for (let i = 0; i <= SEGMENTS; i++) {
      const t = i / SEGMENTS
      const k = Math.round(t * LUT)
      curve.getPointAt(t, P)
      const n = frames.normals[k]
      const b = frames.binormals[k]
      const tw = twistAt(t)
      const c = Math.cos(tw)
      const s = Math.sin(tw)
      // Rotated cross-section axes U (wide) and V (thin).
      const ux = n.x * c + b.x * s, uy = n.y * c + b.y * s, uz = n.z * c + b.z * s
      const vx = -n.x * s + b.x * c, vy = -n.y * s + b.y * c, vz = -n.z * s + b.z * c
      const taper = taperAt(t)
      const A = WIDTH * taper
      const B = THICK * (0.3 + 0.7 * taper)
      for (let j = 0; j <= RADIAL; j++) {
        const phi = (j / RADIAL) * Math.PI * 2
        const cu = Math.cos(phi)
        const sv = Math.sin(phi)
        verts.push(
          P.x + ux * cu * A + vx * sv * B,
          P.y + uy * cu * A + vy * sv * B,
          P.z + uz * cu * A + vz * sv * B,
        )
        // Analytic ellipse normal.
        let nx = ux * (cu / A) + vx * (sv / B)
        let ny = uy * (cu / A) + vy * (sv / B)
        let nz = uz * (cu / A) + vz * (sv / B)
        const len = Math.hypot(nx, ny, nz) || 1
        nx /= len; ny /= len; nz /= len
        norms.push(nx, ny, nz)
      }
    }
    const row = RADIAL + 1
    for (let i = 0; i < SEGMENTS; i++) {
      for (let j = 0; j < RADIAL; j++) {
        const a = i * row + j
        const bq = (i + 1) * row + j
        index.push(a, bq, a + 1, bq, bq + 1, a + 1)
      }
    }
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute(verts, 3))
    g.setAttribute('normal', new Float32BufferAttribute(norms, 3))
    g.setIndex(index)
    return g
  }

  const ribbonMat = track(new MeshPhysicalMaterial({ roughness: 0.72, metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.6, sheen: 0.4, sheenRoughness: 0.8 }))
  const ribbon = new Mesh(track(ribbonGeometry()), ribbonMat)
  world.add(ribbon)

  // A faint echo of the flow behind the ribbon adds depth.
  const echoCurve = new CatmullRomCurve3(curve.points.map((p) => new Vector3(p.x * 1.06 + 0.5, p.y * 1.04 - 0.25, p.z - 1.6)), false, 'centripetal')
  const echoMat = track(new MeshStandardMaterial({ roughness: 0.9, transparent: true, opacity: 0.45 }))
  world.add(new Mesh(track(new TubeGeometry(echoCurve, 260, 0.035, 8, false)), echoMat))

  // ---- Six pearl beads ----
  const pearlGeo = track(new SphereGeometry(0.34, 48, 32))
  const pearlMat = track(new MeshPhysicalMaterial({ roughness: 0.38, clearcoat: 0.8, clearcoatRoughness: 0.25, sheen: 0.5, sheenRoughness: 0.5 }))
  const accentMat = track(new MeshPhysicalMaterial({ roughness: 0.45, clearcoat: 0.6, clearcoatRoughness: 0.3 }))
  const pearls = STAGE_T.map((t, i) => {
    const m = new Mesh(pearlGeo, i === highlight ? accentMat : pearlMat)
    const p = curve.getPointAt(t)
    const k = Math.round(t * LUT)
    m.userData = { base: p.clone(), bob: frames.binormals[k].clone(), phase: i * 1.1 }
    m.position.copy(p)
    if (i === highlight) m.scale.setScalar(1.18)
    world.add(m)
    return m
  })

  // ---- Seeds gliding along the flow (instanced, lit like clay) ----
  const seedGeo = track(new SphereGeometry(0.055, 14, 10))
  const seedMat = track(new MeshStandardMaterial({ roughness: 0.6 }))
  const seedAccentMat = track(new MeshStandardMaterial({ roughness: 0.55 }))
  const accentEvery = 9
  const nAccent = Math.ceil(SEEDS / accentEvery)
  const seedsA = new InstancedMesh(seedGeo, seedMat, SEEDS - nAccent)
  const seedsB = new InstancedMesh(seedGeo, seedAccentMat, nAccent)
  seedsA.instanceMatrix.setUsage(DynamicDrawUsage)
  seedsB.instanceMatrix.setUsage(DynamicDrawUsage)
  seedsA.frustumCulled = false
  seedsB.frustumCulled = false
  world.add(seedsA, seedsB)
  const seedData = Array.from({ length: SEEDS }, () => ({
    t0: Math.random(),
    speed: 0.012 + Math.random() * 0.018,
    ang: Math.random() * Math.PI * 2,
    r: 1.25 + Math.random() * 0.9,
    size: 0.55 + Math.random() * 0.8,
    wob: Math.random() * Math.PI * 2,
  }))
  const dummy = new Object3D()

  function placeSeeds(time) {
    let a = 0
    let b = 0
    for (let i = 0; i < SEEDS; i++) {
      const s = seedData[i]
      const t = (((s.t0 + time * s.speed) % 1) + 1) % 1
      const k = Math.min(LUT, Math.round(t * LUT))
      const p = lutP[k]
      const n = frames.normals[k]
      const bn = frames.binormals[k]
      const ang = s.ang + time * 0.35 + Math.sin(time * 0.8 + s.wob) * 0.2
      const r = s.r * WIDTH * (0.6 + 0.4 * taperAt(t))
      const cu = Math.cos(ang) * r
      const sv = Math.sin(ang) * r * 0.75
      dummy.position.set(p.x + n.x * cu + bn.x * sv, p.y + n.y * cu + bn.y * sv, p.z + n.z * cu + bn.z * sv)
      dummy.scale.setScalar(s.size * Math.max(0.001, Math.sin(t * Math.PI)))
      dummy.updateMatrix()
      if (i % accentEvery === 0) seedsB.setMatrixAt(b++, dummy.matrix)
      else seedsA.setMatrixAt(a++, dummy.matrix)
    }
    seedsA.instanceMatrix.needsUpdate = true
    seedsB.instanceMatrix.needsUpdate = true
  }

  // ---- Colours from tokens ----
  const parse = (name, fallback) => {
    const c = new Color()
    try { c.setStyle(cssVar(name) || fallback) } catch { c.setStyle(fallback) }
    return c
  }
  function applyColors() {
    const dark = document.documentElement.dataset.theme === 'dark'
    ribbonMat.color.copy(dark ? parse('--brand-500', '#6fbb98') : parse('--brand-600', '#1b5a48').lerp(parse('--brand-500', '#2b7560'), 0.7))
    ribbonMat.sheenColor.copy(parse('--brand-300', '#8fbfab'))
    echoMat.color.copy(parse('--brand-300', '#8fbfab'))
    echoMat.opacity = dark ? 0.55 : 0.5
    pearlMat.color.copy(dark ? parse('--text', '#e9efeb') : parse('--surface', '#ffffff'))
    pearlMat.sheenColor.copy(parse('--accent-100', '#fbeacb'))
    const accent = parse('--accent', '#e7a13a')
    accentMat.color.copy(accent)
    accentMat.emissive.copy(accent).multiplyScalar(dark ? 0.18 : 0.08)
    seedMat.color.copy(dark ? parse('--brand-600', '#a6dcc3') : parse('--brand-500', '#2b7560'))
    seedAccentMat.color.copy(accent)
    hemi.color.set(dark ? 0xdfeee6 : 0xffffff)
    hemi.groundColor.copy(dark ? parse('--brand-100', '#1d3a30') : parse('--brand-100', '#dcebe3'))
    hemi.intensity = dark ? 1.25 : 1.9
    key.intensity = dark ? 2.4 : 2.8
  }
  applyColors()

  // ---- Sizing: keep the whole S in frame for any aspect ratio ----
  let baseZ = 20
  function resize() {
    const w = Math.max(1, container.clientWidth)
    const h = Math.max(1, container.clientHeight)
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    const tanHalf = Math.tan((camera.fov * Math.PI) / 360)
    const halfW = 5.6
    const halfH = 4.7
    baseZ = Math.min(Math.max(halfW / (tanHalf * camera.aspect), halfH / tanHalf, 10), 44)
    camera.updateProjectionMatrix()
  }

  // ---- Loop ----
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 }
  let raf = 0
  let visible = true
  let start = performance.now()
  let elapsed = 0

  function pose(time, px, py) {
    world.position.y = Math.sin(time * 0.5) * 0.14
    world.rotation.y = Math.sin(time * 0.21) * 0.16 + px * 0.22
    world.rotation.x = Math.sin(time * 0.17) * 0.05 + py * 0.12
    world.rotation.z = Math.sin(time * 0.13) * 0.025
    pearls.forEach((m, i) => {
      const { base, bob, phase } = m.userData
      const o = Math.sin(time * 1.1 + phase) * 0.06
      m.position.set(base.x + bob.x * o, base.y + bob.y * o, base.z + bob.z * o)
      if (i === highlight) m.scale.setScalar(1.18 + Math.sin(time * 1.6) * 0.04)
    })
    camera.position.set(px * 0.6, -py * 0.35, baseZ)
    camera.lookAt(0, 0, 0)
  }

  function frame(time) {
    pointer.x += (pointer.tx - pointer.x) * 0.045
    pointer.y += (pointer.ty - pointer.y) * 0.045
    pose(time, pointer.x, pointer.y)
    placeSeeds(time)
    renderer.render(scene, camera)
  }

  function renderStatic() {
    pose(0, 0, 0)
    placeSeeds(6)
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
    seedsA.dispose()
    seedsB.dispose()
    disposables.forEach((d) => d.dispose())
    renderer.dispose()
    canvas.remove()
    container.classList.remove('is-ready')
  }
}
