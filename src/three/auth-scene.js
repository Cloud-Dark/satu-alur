/**
 * Auth scene — "the loop".
 *
 * Six stage nodes sit on one continuous, slightly warped orbit (the alur).
 * A few square particles travel along it; one node is "live" and pulses in the
 * signal colour. Drawn like a technical plate: thin ink lines, dotted outer
 * orbit, drop lines to a ground ring, mono node numbers projected as HTML.
 *
 *   const scene = await mountAuthScene(el, { labels: ['01', …] })
 *   scene.setState('sending')   // idle | sending | code | verifying | success | error
 *   scene()                     // cleanup (it is a function with methods)
 *
 * Colours come from tokens. The container may define --scene-bg / --scene-line
 * (e.g. an inverted panel); otherwise --paper / --ink are used.
 */
import { cssVar } from '../ui/theme.js'
import { prefersReducedMotion } from '../ui/reveal.js'

const NODE_COUNT = 6
const RADIUS = 1.6
const PARTICLES = 12
const TILT = 0.5

const SPEED = { idle: 0.028, sending: 0.11, code: 0.04, verifying: 0.13, success: 0.06, error: 0.02 }

function noop() {}

function hasWebGL() {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}

export async function mountAuthScene(container, opts = {}) {
  const fallback = Object.assign(() => {}, { setState: noop })
  if (!container || !hasWebGL()) {
    container?.classList.add('is-fallback')
    return fallback
  }

  let THREE
  try {
    THREE = await import('three')
  } catch {
    container.classList.add('is-fallback')
    return fallback
  }
  if (!container.isConnected) return fallback

  let renderer
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
  } catch {
    container.classList.add('is-fallback')
    return fallback
  }

  const reduced = prefersReducedMotion()
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75))
  renderer.setClearColor(0x000000, 0)
  const canvas = renderer.domElement
  canvas.setAttribute('aria-hidden', 'true')
  canvas.className = 'auth-scene-canvas'
  container.appendChild(canvas)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 60)
  const disposables = []
  const track = (o) => { disposables.push(o); return o }

  /* ---------- colours ---------- */
  const col = { bg: new THREE.Color(), line: new THREE.Color(), signal: new THREE.Color() }
  function readVar(name, fallbackName) {
    const v = getComputedStyle(container).getPropertyValue(name).trim()
    return v || cssVar(fallbackName)
  }
  function readColors() {
    col.bg.set(readVar('--scene-bg', '--paper') || '#f3efe6')
    col.line.set(readVar('--scene-line', '--ink') || '#16150f')
    col.signal.set(cssVar('--signal') || '#c6f24e')
  }
  readColors()

  /* ---------- geometry ---------- */
  const world = new THREE.Group()
  const ring = new THREE.Group()
  world.add(ring)
  scene.add(world)
  world.rotation.x = TILT

  // Node positions: a warped orbit, alternating height and radius.
  const nodePos = []
  for (let i = 0; i < NODE_COUNT; i++) {
    const a = (i / NODE_COUNT) * Math.PI * 2 - Math.PI / 2
    const r = RADIUS * (i % 2 ? 0.9 : 1.05)
    nodePos.push(new THREE.Vector3(Math.cos(a) * r, (i % 2 ? -0.16 : 0.2), Math.sin(a) * r))
  }
  const curve = new THREE.CatmullRomCurve3(nodePos, true, 'centripetal', 0.5)

  // Main loop: a thin tube so the line has real weight.
  const tubeGeo = track(new THREE.TubeGeometry(curve, 360, 0.014, 6, true))
  const tubeMat = track(new THREE.MeshBasicMaterial({ color: col.line }))
  ring.add(new THREE.Mesh(tubeGeo, tubeMat))

  // Ghost loop: offset copy, faint — reads as motion trace.
  const ghostPts = curve.getSpacedPoints(300).map((p) => p.clone().multiplyScalar(1.12).setY(p.y * 0.6 - 0.02))
  const ghostGeo = track(new THREE.BufferGeometry().setFromPoints(ghostPts))
  const ghostMat = track(new THREE.LineDashedMaterial({ color: col.line, transparent: true, opacity: 0.32, dashSize: 0.05, gapSize: 0.06 }))
  const ghost = new THREE.Line(ghostGeo, ghostMat)
  ghost.computeLineDistances()
  ring.add(ghost)

  // Outer dotted orbit.
  const outerPts = []
  for (let i = 0; i < 160; i++) {
    const a = (i / 160) * Math.PI * 2
    outerPts.push(new THREE.Vector3(Math.cos(a) * 2.2, 0, Math.sin(a) * 2.2))
  }
  const outerGeo = track(new THREE.BufferGeometry().setFromPoints(outerPts))
  const outerMat = track(new THREE.PointsMaterial({ color: col.line, size: 2, sizeAttenuation: false, transparent: true, opacity: 0.55 }))
  ring.add(new THREE.Points(outerGeo, outerMat))

  // Tick marks on the outer orbit (every 15deg, longer every 60deg).
  const tickPts = []
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2 - Math.PI / 2
    const len = i % 4 === 0 ? 0.18 : 0.07
    tickPts.push(new THREE.Vector3(Math.cos(a) * 2.2, 0, Math.sin(a) * 2.2))
    tickPts.push(new THREE.Vector3(Math.cos(a) * (2.2 + len), 0, Math.sin(a) * (2.2 + len)))
  }
  const tickGeo = track(new THREE.BufferGeometry().setFromPoints(tickPts))
  const faintMat = track(new THREE.LineBasicMaterial({ color: col.line, transparent: true, opacity: 0.45 }))
  ring.add(new THREE.LineSegments(tickGeo, faintMat))

  // Hub: small inner ring + spokes to each node.
  const hubPts = []
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * Math.PI * 2
    hubPts.push(new THREE.Vector3(Math.cos(a) * 0.32, 0, Math.sin(a) * 0.32))
  }
  const hubGeo = track(new THREE.BufferGeometry().setFromPoints(hubPts))
  ring.add(new THREE.Line(hubGeo, faintMat))
  const spokePts = []
  nodePos.forEach((p) => {
    const d = new THREE.Vector3(p.x, 0, p.z).normalize()
    spokePts.push(d.clone().multiplyScalar(0.32), new THREE.Vector3(p.x, p.y, p.z).multiplyScalar(0.94))
  })
  const spokeGeo = track(new THREE.BufferGeometry().setFromPoints(spokePts))
  const spokeMat = track(new THREE.LineDashedMaterial({ color: col.line, transparent: true, opacity: 0.3, dashSize: 0.04, gapSize: 0.05 }))
  const spokes = new THREE.LineSegments(spokeGeo, spokeMat)
  spokes.computeLineDistances()
  ring.add(spokes)

  // Ground ring + drop lines (depth cue).
  const GROUND = -0.95
  const groundPts = hubPts.map((p) => new THREE.Vector3(p.x * 5.4, GROUND, p.z * 5.4))
  const groundGeo = track(new THREE.BufferGeometry().setFromPoints(groundPts))
  const groundMat = track(new THREE.LineBasicMaterial({ color: col.line, transparent: true, opacity: 0.18 }))
  ring.add(new THREE.Line(groundGeo, groundMat))
  const dropPts = []
  nodePos.forEach((p) => dropPts.push(p.clone(), new THREE.Vector3(p.x, GROUND, p.z)))
  const dropGeo = track(new THREE.BufferGeometry().setFromPoints(dropPts))
  const dropMat = track(new THREE.LineDashedMaterial({ color: col.line, transparent: true, opacity: 0.35, dashSize: 0.03, gapSize: 0.05 }))
  const drops = new THREE.LineSegments(dropGeo, dropMat)
  drops.computeLineDistances()
  ring.add(drops)
  const footGeo = track(new THREE.BufferGeometry().setFromPoints(nodePos.map((p) => new THREE.Vector3(p.x, GROUND, p.z))))
  const footMat = track(new THREE.PointsMaterial({ color: col.line, size: 4, sizeAttenuation: false, transparent: true, opacity: 0.5 }))
  ring.add(new THREE.Points(footGeo, footMat))

  // Nodes: filled octahedron (occludes the line) + ink edges.
  const nodeGeo = track(new THREE.OctahedronGeometry(0.12, 0))
  const nodeEdgeGeo = track(new THREE.EdgesGeometry(nodeGeo))
  const nodeEdgeMat = track(new THREE.LineBasicMaterial({ color: col.line }))
  const nodes = nodePos.map((p) => {
    const mat = track(new THREE.MeshBasicMaterial({ color: col.bg }))
    const g = new THREE.Group()
    g.position.copy(p)
    g.add(new THREE.Mesh(nodeGeo, mat))
    g.add(new THREE.LineSegments(nodeEdgeGeo, nodeEdgeMat))
    ring.add(g)
    return { group: g, mat, lit: 0 }
  })

  // Pulse halo (billboarded square ring) around the live node.
  const haloPts = []
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * Math.PI * 2
    haloPts.push(new THREE.Vector3(Math.cos(a) * 0.2, Math.sin(a) * 0.2, 0))
  }
  const haloGeo = track(new THREE.BufferGeometry().setFromPoints(haloPts))
  const haloMat = track(new THREE.LineBasicMaterial({ color: col.signal, transparent: true, opacity: 0.9 }))
  const halo = new THREE.Line(haloGeo, haloMat)
  scene.add(halo)
  const halo2Mat = track(new THREE.LineBasicMaterial({ color: col.signal, transparent: true, opacity: 0.6 }))
  const halo2 = new THREE.Line(haloGeo, halo2Mat)
  scene.add(halo2)

  // Particles travelling the loop.
  const LUT = curve.getSpacedPoints(720)
  const pPos = new Float32Array(PARTICLES * 3)
  const pGeo = track(new THREE.BufferGeometry())
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3))
  const pMat = track(new THREE.PointsMaterial({ color: col.line, size: 6, sizeAttenuation: false }))
  ring.add(new THREE.Points(pGeo, pMat))
  const pOffsets = Array.from({ length: PARTICLES }, (_, i) => i / PARTICLES + (Math.sin(i * 12.9898) * 0.5 + 0.5) * 0.04)
  // A single lead particle in signal colour.
  const leadPos = new Float32Array(3)
  const leadGeo = track(new THREE.BufferGeometry())
  leadGeo.setAttribute('position', new THREE.BufferAttribute(leadPos, 3))
  const leadMat = track(new THREE.PointsMaterial({ color: col.signal, size: 9, sizeAttenuation: false }))
  ring.add(new THREE.Points(leadGeo, leadMat))

  function samplePoint(t, out, offset = 0) {
    const f = ((t % 1) + 1) % 1
    const p = LUT[Math.floor(f * (LUT.length - 1))]
    out[offset] = p.x; out[offset + 1] = p.y; out[offset + 2] = p.z
  }

  /* ---------- HTML labels ---------- */
  const labelLayer = document.createElement('div')
  labelLayer.className = 'auth-scene-labels'
  labelLayer.setAttribute('aria-hidden', 'true')
  const labelTexts = opts.labels || nodePos.map((_, i) => String(i + 1).padStart(2, '0'))
  const labels = labelTexts.map((t) => {
    const s = document.createElement('span')
    s.textContent = t
    labelLayer.appendChild(s)
    return s
  })
  container.appendChild(labelLayer)

  /* ---------- state ---------- */
  let state = 'idle'
  let activeIndex = 0
  let speed = SPEED.idle
  let targetSpeed = SPEED.idle
  let flow = 0
  let spin = 0
  let jolt = 0
  let successAt = -1
  let width = 1
  let height = 1
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 }
  const tmp = new THREE.Vector3()

  function applyColors() {
    tubeMat.color.copy(state === 'success' ? col.signal : col.line)
    ;[ghostMat, outerMat, faintMat, spokeMat, groundMat, dropMat, footMat, nodeEdgeMat, pMat].forEach((m) => m.color.copy(col.line))
    haloMat.color.copy(col.signal)
    halo2Mat.color.copy(col.signal)
    leadMat.color.copy(col.signal)
    nodes.forEach((n) => n.mat.color.copy(col.bg))
  }

  function layout() {
    const rect = container.getBoundingClientRect()
    width = Math.max(1, Math.round(rect.width))
    height = Math.max(1, Math.round(rect.height))
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    // Fit: the orbit needs ~5.4 units across and ~3.3 tall.
    //  - tall panel (desktop): orbit in the upper half, statement below.
    //  - wide band (mobile header): orbit fills the height, pushed right so
    //    the logo and status line keep clear space on the left.
    const aspect = camera.aspect
    const tall = aspect < 1.25
    const band = aspect > 1.6
    const t = 2 * Math.tan(((camera.fov * Math.PI) / 180) / 2)
    let dist
    if (band) dist = 3.3 / (t * 0.98)
    else dist = Math.max(3.3 / (t * (tall ? 0.5 : 0.86)), 5.4 / (t * aspect * 0.94))
    camera.position.set(0, 0, dist)
    camera.lookAt(0, 0, 0)
    const xOff = band ? -width * 0.2 : 0
    const yOff = tall ? height * 0.2 : band ? -height * 0.03 : 0
    camera.setViewOffset(width, height, xOff, yOff, width, height)
    camera.updateProjectionMatrix()
  }

  function setActive(i) {
    activeIndex = ((i % NODE_COUNT) + NODE_COUNT) % NODE_COUNT
  }

  function frame(time, dt) {
    speed += (targetSpeed - speed) * Math.min(1, dt * 3)
    flow += speed * dt
    spin += dt * (state === 'sending' || state === 'verifying' ? 0.18 : 0.05)
    jolt *= Math.pow(0.02, dt)

    pointer.x += (pointer.tx - pointer.x) * Math.min(1, dt * 2.5)
    pointer.y += (pointer.ty - pointer.y) * Math.min(1, dt * 2.5)
    ring.rotation.y = spin + Math.sin(time * 38) * jolt * 0.08
    world.rotation.x = TILT + pointer.y * 0.12
    world.rotation.z = pointer.x * -0.06
    world.position.x = pointer.x * 0.08

    for (let i = 0; i < PARTICLES; i++) samplePoint(flow + pOffsets[i], pPos, i * 3)
    pGeo.attributes.position.needsUpdate = true
    samplePoint(flow * 1.0 + 0.5, leadPos, 0)
    leadGeo.attributes.position.needsUpdate = true

    // Node colours: live node in signal; on success a sweep lights all.
    nodes.forEach((n, i) => {
      let target = i === activeIndex ? 1 : 0
      if (successAt >= 0 && time - successAt > i * 0.09) target = 1
      n.lit += (target - n.lit) * Math.min(1, dt * 8)
      n.mat.color.copy(col.bg).lerp(col.signal, n.lit)
      n.group.rotation.y = time * 0.6 + i
      const s = 1 + n.lit * 0.25
      n.group.scale.setScalar(s)
    })

    // Halo follows the live node in world space, faces camera.
    nodes[activeIndex].group.getWorldPosition(tmp)
    const period = state === 'sending' || state === 'verifying' ? 0.7 : 1.7
    const ph = (time % period) / period
    const ph2 = ((time + period / 2) % period) / period
    halo.position.copy(tmp); halo2.position.copy(tmp)
    halo.quaternion.copy(camera.quaternion); halo2.quaternion.copy(camera.quaternion)
    halo.scale.setScalar(1 + ph * 1.8); haloMat.opacity = 0.95 * (1 - ph)
    halo2.scale.setScalar(1 + ph2 * 1.8); halo2Mat.opacity = 0.6 * (1 - ph2)
  }

  function placeLabels() {
    world.updateMatrixWorld()
    nodes.forEach((n, i) => {
      n.group.getWorldPosition(tmp)
      tmp.y += 0.24
      tmp.project(camera)
      const x = (tmp.x * 0.5 + 0.5) * width
      const y = (-tmp.y * 0.5 + 0.5) * height
      labels[i].style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`
      labels[i].classList.toggle('is-live', i === activeIndex || (successAt >= 0))
    })
  }

  function renderOnce() {
    renderer.render(scene, camera)
    placeLabels()
  }

  /* ---------- loop ---------- */
  let raf = 0
  let last = 0
  let elapsed = 0
  let visible = true
  let inView = true
  let disposed = false

  function tick(now) {
    raf = 0
    if (disposed) return
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016
    last = now
    elapsed += dt
    frame(elapsed, dt)
    renderOnce()
    schedule()
  }
  function schedule() {
    if (reduced || disposed || raf || !visible || !inView) return
    raf = requestAnimationFrame(tick)
  }
  function stop() {
    if (raf) cancelAnimationFrame(raf)
    raf = 0
    last = 0
  }
  function staticFrame() {
    // Reduced motion: a composed still. Snap state instantly.
    speed = targetSpeed
    nodes.forEach((n, i) => { n.lit = i === activeIndex || successAt >= 0 ? 1 : 0 })
    frame(elapsed + 0.0001, 0)
    nodes.forEach((n, i) => {
      n.mat.color.copy(col.bg).lerp(col.signal, i === activeIndex || successAt >= 0 ? 1 : 0)
    })
    halo.scale.setScalar(1.5); haloMat.opacity = 0.7
    halo2Mat.opacity = 0
    renderOnce()
  }

  const ro = new ResizeObserver(() => {
    layout()
    if (reduced) staticFrame()
    else if (!raf) renderOnce()
  })
  ro.observe(container)

  const io = 'IntersectionObserver' in window
    ? new IntersectionObserver(([e]) => {
      inView = e.isIntersecting
      if (inView) schedule(); else stop()
    })
    : null
  io?.observe(container)

  const onVisibility = () => {
    visible = document.visibilityState === 'visible'
    if (visible) schedule(); else stop()
  }
  document.addEventListener('visibilitychange', onVisibility)

  const onPointer = (e) => {
    pointer.tx = (e.clientX / window.innerWidth) * 2 - 1
    pointer.ty = (e.clientY / window.innerHeight) * 2 - 1
  }
  if (!reduced) window.addEventListener('pointermove', onPointer, { passive: true })

  const onTheme = () => {
    // Wait a frame so container-level variables have recomputed.
    requestAnimationFrame(() => {
      if (disposed) return
      readColors()
      applyColors()
      if (reduced || !raf) staticFrame()
    })
  }
  window.addEventListener('themechange', onTheme)

  const onContextLost = (e) => { e.preventDefault(); stop(); container.classList.add('is-fallback') }
  canvas.addEventListener('webglcontextlost', onContextLost)

  layout()
  applyColors()
  if (reduced) staticFrame()
  else {
    renderOnce()
    schedule()
  }
  container.classList.add('is-ready')

  function setState(next) {
    if (disposed || !SPEED[next]) return
    state = next
    targetSpeed = SPEED[next]
    if (next === 'idle') { setActive(0); successAt = -1 }
    if (next === 'sending') setActive(0)
    if (next === 'code' || next === 'verifying') setActive(1)
    if (next === 'error') jolt = 1
    if (next === 'success') successAt = elapsed
    tubeMat.color.copy(next === 'success' ? col.signal : col.line)
    if (reduced) staticFrame()
  }

  function cleanup() {
    if (disposed) return
    disposed = true
    stop()
    ro.disconnect()
    io?.disconnect()
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('pointermove', onPointer)
    window.removeEventListener('themechange', onTheme)
    canvas.removeEventListener('webglcontextlost', onContextLost)
    disposables.forEach((d) => d.dispose?.())
    renderer.dispose()
    renderer.forceContextLoss?.()
    canvas.remove()
    labelLayer.remove()
    container.classList.remove('is-ready')
  }
  cleanup.setState = setState
  return cleanup
}
