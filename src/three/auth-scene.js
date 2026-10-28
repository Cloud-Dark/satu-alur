/**
 * Auth scene — a calm "clay" composition for the login panel.
 *
 * Soft matte shapes (spheres, two tori) float and slowly orbit around one
 * smooth curved tube: the alur. Small beads travel along the tube. Motion
 * follows the login state:
 *   idle       slow float
 *   sending    shapes gather toward the line, beads flow faster
 *   code       a little livelier than idle
 *   verifying  gathered, fast flow
 *   success    gentle turmeric pulse ring + lift
 *   error      short damped shake
 *
 *   const scene = await mountAuthScene(el)
 *   scene.setState('sending')
 *   scene()        // cleanup (a function with a setState method)
 *
 * Colours come from tokens via CSS custom properties on the container
 * (--scene-a/-b/-c/-line/-bg), falling back to :root tokens. They are
 * re-read on 'themechange'.
 */
import { cssVar } from '../ui/theme.js'
import { prefersReducedMotion } from '../ui/reveal.js'

const STATES = {
  idle:      { speed: 1,    gather: 0,    flow: 1,   lift: 0 },
  sending:   { speed: 2.4,  gather: 0.38, flow: 3.4, lift: 0 },
  code:      { speed: 1.3,  gather: 0.1,  flow: 1.5, lift: 0 },
  verifying: { speed: 2.2,  gather: 0.46, flow: 3.8, lift: 0 },
  success:   { speed: 1.1,  gather: 0.16, flow: 1.6, lift: 0.16 },
  error:     { speed: 0.7,  gather: 0,    flow: 0.7, lift: 0 },
}

// Composition half-extent (world units) the camera keeps in view.
const HALF_W = 3.1
const HALF_H = 2.1
const FOV = 34

function noop() {}

function hasWebGL() {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}

const lerp = (a, b, t) => a + (b - a) * t

/** Named destructuring straight from the dynamic import so Rollup can tree-shake three. */
async function loadThree() {
  const {
    WebGLRenderer, Scene, PerspectiveCamera, Group, Mesh, Color, Vector3,
    SphereGeometry, TorusGeometry, TubeGeometry, CatmullRomCurve3,
    MeshStandardMaterial, MeshBasicMaterial,
    HemisphereLight, DirectionalLight, AmbientLight,
  } = await import('three')
  return {
    WebGLRenderer, Scene, PerspectiveCamera, Group, Mesh, Color, Vector3,
    SphereGeometry, TorusGeometry, TubeGeometry, CatmullRomCurve3,
    MeshStandardMaterial, MeshBasicMaterial,
    HemisphereLight, DirectionalLight, AmbientLight,
  }
}

export async function mountAuthScene(container, opts = {}) {
  const fallback = Object.assign(() => {}, { setState: noop })
  if (!container || !hasWebGL()) {
    container?.classList.add('is-fallback')
    return fallback
  }

  let three
  try {
    three = await loadThree()
  } catch {
    container.classList.add('is-fallback')
    return fallback
  }
  if (!container.isConnected) return fallback

  const {
    WebGLRenderer, Scene, PerspectiveCamera, Group, Mesh, Color, Vector3,
    SphereGeometry, TorusGeometry, TubeGeometry, CatmullRomCurve3,
    MeshStandardMaterial, MeshBasicMaterial,
    HemisphereLight, DirectionalLight, AmbientLight,
  } = three

  let renderer
  try {
    renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
  } catch {
    container.classList.add('is-fallback')
    return fallback
  }

  const reduced = opts.reducedMotion ?? prefersReducedMotion()
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75))
  renderer.setClearColor(0x000000, 0)
  const canvas = renderer.domElement
  canvas.setAttribute('aria-hidden', 'true')
  canvas.className = 'auth-scene-canvas'
  container.appendChild(canvas)

  const scene = new Scene()
  const camera = new PerspectiveCamera(FOV, 1, 0.1, 80)
  camera.position.set(0, 0, 9)

  const geometries = []
  const materials = []
  const geo = (g) => { geometries.push(g); return g }
  const mat = (m) => { materials.push(m); return m }

  /* ---------- colours ---------- */
  const col = {
    a: new Color('#f7f4ee'),
    b: new Color('#8fbfab'),
    c: new Color('#e7a13a'),
    line: new Color('#f7f4ee'),
    bg: new Color('#134235'),
  }
  function readVar(name, rootName, fb) {
    let v = ''
    try { v = getComputedStyle(container).getPropertyValue(name).trim() } catch { /* detached */ }
    if (!v && rootName) v = cssVar(rootName)
    return v || fb
  }
  function safeSet(color, value) {
    try { color.set(value) } catch { /* unparsable value: keep previous */ }
  }

  /* ---------- lights ---------- */
  const hemi = new HemisphereLight(0xffffff, 0x134235, 1.25)
  const key = new DirectionalLight(0xfff6e6, 2.1)
  key.position.set(-3.5, 5, 6)
  const rim = new DirectionalLight(0xffffff, 0.55)
  rim.position.set(4, -2, 3)
  const ambient = new AmbientLight(0xffffff, 0.25)
  scene.add(hemi, key, rim, ambient)

  /* ---------- composition ---------- */
  const world = new Group()
  scene.add(world)

  // The line runs well past both edges so its ends are never in view.
  const flowPts = [
    new Vector3(-8.5, -0.7, -0.8),
    new Vector3(-4.4, -1.15, -0.4),
    new Vector3(-2.6, -1.4, 0.5),
    new Vector3(-1.1, -0.35, 0.2),
    new Vector3(0.4, 0.15, -0.3),
    new Vector3(1.9, 1.05, 0.25),
    new Vector3(3.2, 0.85, -0.2),
    new Vector3(4.6, 1.25, -0.6),
    new Vector3(8.5, 1.0, -0.9),
  ]
  const curve = new CatmullRomCurve3(flowPts, false, 'centripetal', 0.5)

  const clay = (color) => mat(new MeshStandardMaterial({ color, roughness: 0.88, metalness: 0, flatShading: false }))
  const matA = clay(col.a)
  const matB = clay(col.b)
  const matC = clay(col.c)
  const matLine = clay(col.line)
  const matPulse = mat(new MeshBasicMaterial({ color: col.c, transparent: true, opacity: 0, depthWrite: false }))

  const tube = new Mesh(geo(new TubeGeometry(curve, 320, 0.075, 16, false)), matLine)
  world.add(tube)
  // A faint parallel trace gives the line some depth.
  const tracePts = flowPts.map((p) => new Vector3(p.x, p.y - 0.34, p.z - 0.5))
  const trace = new Mesh(geo(new TubeGeometry(new CatmullRomCurve3(tracePts, false, 'centripetal', 0.5), 240, 0.028, 8, false)), matB)
  world.add(trace)

  const sphereGeo = geo(new SphereGeometry(1, 48, 32))
  const torusGeo = geo(new TorusGeometry(1, 0.34, 28, 72))

  /**
   * Floating shapes. anchor = resting position; orbit = small ellipse radius;
   * spin = self rotation speed (tori).
   */
  const shapeDefs = [
    { kind: 'sphere', r: 0.78, m: matB, anchor: [-1.35, 0.62, -0.7], orbit: 0.12, phase: 0.0 },
    { kind: 'sphere', r: 0.44, m: matA, anchor: [1.95, -0.62, 0.35], orbit: 0.14, phase: 1.7 },
    { kind: 'sphere', r: 0.25, m: matC, anchor: [0.3, 1.05, 0.85], orbit: 0.1, phase: 3.1, accent: true },
    { kind: 'torus', r: 0.42, m: matA, anchor: [1.15, 1.35, -0.5], orbit: 0.1, phase: 2.2, spin: [0.35, 0.22], tilt: [1.1, 0.3] },
    { kind: 'torus', r: 0.27, m: matB, anchor: [-2.45, -0.55, 0.6], orbit: 0.12, phase: 4.4, spin: [-0.25, 0.3], tilt: [0.6, -0.5] },
    { kind: 'sphere', r: 0.13, m: matA, anchor: [-0.25, -1.25, 0.9], orbit: 0.16, phase: 5.1 },
    { kind: 'sphere', r: 0.1, m: matC, anchor: [2.75, 0.2, 0.7], orbit: 0.16, phase: 0.8 },
    { kind: 'sphere', r: 0.16, m: matB, anchor: [-3.1, 1.15, -0.3], orbit: 0.14, phase: 2.9 },
  ]
  const shapes = shapeDefs.map((d) => {
    const mesh = new Mesh(d.kind === 'torus' ? torusGeo : sphereGeo, d.m)
    mesh.scale.setScalar(d.r)
    if (d.tilt) mesh.rotation.set(d.tilt[0], d.tilt[1], 0)
    world.add(mesh)
    return { ...d, mesh, anchorV: new Vector3(...d.anchor), baseScale: d.r }
  })
  const accentShape = shapes.find((s) => s.accent)
  const bigShape = shapes[0]

  // Satellites orbiting the big sphere on a tilted ring.
  const satellites = [0, 1].map((i) => {
    const mesh = new Mesh(sphereGeo, i === 0 ? matA : matC)
    mesh.scale.setScalar(i === 0 ? 0.085 : 0.07)
    world.add(mesh)
    return { mesh, radius: i === 0 ? 1.12 : 1.3, speed: i === 0 ? 0.55 : -0.4, phase: i * 2.4 }
  })

  // Beads travelling along the flow.
  const beads = [0, 1, 2, 3, 4, 5].map((i) => {
    const mesh = new Mesh(sphereGeo, i % 3 === 1 ? matC : matA)
    const base = i % 3 === 1 ? 0.13 : 0.1
    mesh.scale.setScalar(base)
    world.add(mesh)
    return { mesh, base, offset: i / 6 }
  })

  // Success pulse ring around the accent sphere.
  const pulse = new Mesh(geo(new TorusGeometry(1, 0.035, 12, 96)), matPulse)
  pulse.visible = false
  world.add(pulse)

  /* ---------- colours applied ---------- */
  function readColors() {
    safeSet(col.a, readVar('--scene-a', '--bg', '#f7f4ee'))
    safeSet(col.b, readVar('--scene-b', '--brand-300', '#8fbfab'))
    safeSet(col.c, readVar('--scene-c', '--accent', '#e7a13a'))
    safeSet(col.line, readVar('--scene-line', '--bg', '#f7f4ee'))
    safeSet(col.bg, readVar('--scene-bg', '--brand', '#134235'))
    matA.color.copy(col.a)
    matB.color.copy(col.b)
    matC.color.copy(col.c)
    matLine.color.copy(col.line)
    matPulse.color.copy(col.c)
    hemi.groundColor.copy(col.bg)
  }
  readColors()

  /* ---------- sizing ---------- */
  function fit(w, hgt) {
    const aspect = w / Math.max(1, hgt)
    camera.aspect = aspect
    const t = Math.tan((FOV * Math.PI) / 360)
    // Wide strips (mobile band) crop tighter so the shapes stay legible.
    const pad = aspect > 2 ? 0.1 : 1.2
    const dist = Math.max(HALF_H / t, HALF_W / (t * aspect)) + pad
    camera.position.z = dist
    camera.updateProjectionMatrix()
  }
  function resize() {
    const w = Math.max(1, Math.round(container.clientWidth))
    const hgt = Math.max(1, Math.round(container.clientHeight))
    renderer.setSize(w, hgt, false)
    fit(w, hgt)
  }

  /* ---------- animation ---------- */
  let state = 'idle'
  const cur = { ...STATES.idle }
  let t = 2.2 // scene time (advances with speed)
  let flowT = 0
  let shakeLeft = 0
  let pulseT = -1
  let raf = 0
  let last = 0
  let visible = true
  let disposed = false
  const tmp = new Vector3()
  const center = new Vector3(0.2, 0.1, 0.1)

  function update(dt) {
    const target = STATES[state] || STATES.idle
    const k = 1 - Math.exp(-dt * 3)
    cur.speed = lerp(cur.speed, target.speed, k)
    cur.gather = lerp(cur.gather, target.gather, k)
    cur.flow = lerp(cur.flow, target.flow, k)
    cur.lift = lerp(cur.lift, target.lift, k)
    t += dt * cur.speed
    flowT = (flowT + dt * 0.028 * cur.flow) % 1

    for (const s of shapes) {
      tmp.copy(s.anchorV).lerp(center, cur.gather)
      const ph = s.phase
      s.mesh.position.set(
        tmp.x + Math.cos(t * 0.42 + ph) * s.orbit,
        tmp.y + Math.sin(t * 0.55 + ph) * s.orbit * 0.9 + cur.lift * (1 + s.r),
        tmp.z + Math.sin(t * 0.35 + ph) * s.orbit * 0.6,
      )
      if (s.spin) {
        s.mesh.rotation.x = s.tilt[0] + t * s.spin[0]
        s.mesh.rotation.y = s.tilt[1] + t * s.spin[1]
      }
      s.mesh.scale.setScalar(s.baseScale)
    }

    const bp = bigShape.mesh.position
    for (const sat of satellites) {
      const a = t * sat.speed + sat.phase
      sat.mesh.position.set(
        bp.x + Math.cos(a) * sat.radius,
        bp.y + Math.sin(a) * sat.radius * 0.32,
        bp.z + Math.sin(a) * sat.radius,
      )
    }

    for (const b of beads) {
      const u = (flowT + b.offset) % 1
      const p = curve.getPointAt(u)
      if (p) b.mesh.position.copy(p)
      const edge = Math.min(u, 1 - u) // fade in/out at the ends via scale
      const s = Math.max(0.02, Math.min(1, edge * 12))
      b.mesh.scale.setScalar(b.base * s)
    }

    // Success: turmeric pulse.
    if (pulseT >= 0 && accentShape) {
      pulseT += dt
      const p = Math.min(1, pulseT / 1.4)
      const ease = 1 - Math.pow(1 - p, 3)
      pulse.visible = true
      pulse.position.copy(accentShape.mesh.position)
      pulse.scale.setScalar(0.3 + ease * 1.5)
      matPulse.opacity = 0.75 * (1 - p)
      accentShape.mesh.scale.setScalar(accentShape.baseScale * (1 + 0.32 * Math.sin(Math.PI * Math.min(1, pulseT / 0.7))))
      if (p >= 1) {
        pulseT = state === 'success' ? 0 : -1 // keep breathing while in success
        if (pulseT < 0) pulse.visible = false
      }
    }

    // Error: damped shake.
    if (shakeLeft > 0) {
      shakeLeft = Math.max(0, shakeLeft - dt)
      const amp = 0.09 * (shakeLeft / 0.5)
      world.position.x = Math.sin(shakeLeft * 55) * amp
    } else {
      world.position.x = 0
    }

    world.rotation.y = Math.sin(t * 0.12) * 0.16
    world.rotation.x = Math.sin(t * 0.09 + 1) * 0.05
  }

  function render() {
    renderer.render(scene, camera)
  }

  function frame(now) {
    raf = 0
    if (disposed) return
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016)
    last = now
    update(dt)
    render()
    schedule()
  }
  function running() {
    return !disposed && !reduced && visible && document.visibilityState !== 'hidden'
  }
  function schedule() {
    if (!raf && running()) raf = requestAnimationFrame(frame)
  }
  function stop() {
    if (raf) cancelAnimationFrame(raf)
    raf = 0
    last = 0
  }
  function staticFrame() {
    update(0)
    render()
  }

  /* ---------- observers & events ---------- */
  const ro = new ResizeObserver(() => {
    if (disposed) return
    resize()
    if (!running()) render()
  })
  ro.observe(container)

  const io = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => {
      visible = entries.some((e) => e.isIntersecting)
      if (visible) schedule()
      else stop()
    })
    : null
  io?.observe(container)

  const onVisibility = () => {
    if (document.visibilityState === 'hidden') stop()
    else schedule()
  }
  document.addEventListener('visibilitychange', onVisibility)

  const onTheme = () => {
    // Token values change after the attribute flips; read on the next frame.
    requestAnimationFrame(() => {
      if (disposed) return
      readColors()
      if (!running()) render()
    })
  }
  window.addEventListener('themechange', onTheme)

  const onLost = (e) => {
    e.preventDefault()
    stop()
    container.classList.add('is-fallback')
    container.classList.remove('is-ready')
  }
  canvas.addEventListener('webglcontextlost', onLost)

  resize()
  staticFrame()
  container.classList.add('is-ready')
  schedule()

  function setState(next) {
    if (!STATES[next] || disposed) return
    const prev = state
    state = next
    if (next === 'error') shakeLeft = 0.5
    if (next === 'success' && prev !== 'success') pulseT = 0
    if (reduced) {
      // Static: jump straight to the target pose.
      Object.assign(cur, STATES[next])
      shakeLeft = 0
      pulseT = -1
      pulse.visible = false
      staticFrame()
    } else {
      schedule()
    }
  }

  function cleanup() {
    if (disposed) return
    disposed = true
    stop()
    ro.disconnect()
    io?.disconnect()
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('themechange', onTheme)
    canvas.removeEventListener('webglcontextlost', onLost)
    geometries.forEach((g) => g.dispose())
    materials.forEach((m) => m.dispose())
    scene.clear()
    renderer.dispose()
    try { renderer.forceContextLoss() } catch { /* already lost */ }
    canvas.remove()
    container.classList.remove('is-ready')
  }

  return Object.assign(cleanup, { setState })
}
