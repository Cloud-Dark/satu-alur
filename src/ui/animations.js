/**
 * Animation & visual effects utilities for Satu Alur
 * AntiSlop-compliant — semua warna menggunakan TOKENS
 */

import { TOKENS } from './antislop.js'

export function createParticleBackground(container) {
  const canvas = document.createElement('canvas')
  canvas.className = 'particle-canvas'
  container.prepend(canvas)

  const ctx = canvas.getContext('2d')
  let particles = []
  let animationId = null

  function resize() {
    canvas.width = container.clientWidth
    canvas.height = container.clientHeight
  }
  resize()
  window.addEventListener('resize', resize)

  // Warm orange & brown tones only
  const colors = [
    TOKENS.colors.primary,
    TOKENS.colors.secondary,
    TOKENS.colors.accent.sand,
    TOKENS.colors.accent.terracotta,
  ]

  for (let i = 0; i < 30; i++) {
    particles.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: Math.random() * 2 + 0.5,
      dx: (Math.random() - 0.5) * 0.3,
      dy: (Math.random() - 0.5) * 0.3,
      color: colors[Math.floor(Math.random() * colors.length)],
      alpha: Math.random() * 0.3 + 0.1,
    })
  }

  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    particles.forEach(p => {
      p.x += p.dx
      p.y += p.dy
      if (p.x < 0 || p.x > canvas.width) p.dx *= -1
      if (p.y < 0 || p.y > canvas.height) p.dy *= -1
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
      ctx.fillStyle = p.color
      ctx.globalAlpha = p.alpha
      ctx.fill()
    })
    ctx.globalAlpha = 1
    animationId = requestAnimationFrame(animate)
  }
  animate()

  return () => {
    cancelAnimationFrame(animationId)
    window.removeEventListener('resize', resize)
  }
}

export function animateEntrance(element, delay = 0) {
  element.style.opacity = '0'
  element.style.transform = 'translateY(12px) scale(0.99)'
  element.style.transition = 'opacity 0.4s ease, transform 0.4s ease'
  setTimeout(() => {
    element.style.opacity = '1'
    element.style.transform = 'translateY(0) scale(1)'
  }, delay)
}

export function pulseEffect(element) {
  element.style.animation = 'pulse-glow 2s infinite'
}

export function showToast(message, type = 'info', duration = 3000) {
  if (!message || message.length < 3) {
    console.warn('[AntiSlop] Toast message terlalu pendek:', message)
    return
  }

  const toast = document.createElement('div')
  toast.className = `toast toast-${type}`
  toast.textContent = message
  document.body.appendChild(toast)

  requestAnimationFrame(() => {
    toast.classList.add('show')
  })

  setTimeout(() => {
    toast.classList.remove('show')
    setTimeout(() => toast.remove(), 300)
  }, duration)
}

export function typewriterEffect(element, text, speed = 30) {
  if (!text || text.length < 2) {
    console.warn('[AntiSlop] Typewriter text terlalu pendek')
    return () => {}
  }
  element.textContent = ''
  let i = 0
  const timer = setInterval(() => {
    element.textContent += text.charAt(i)
    i++
    if (i >= text.length) clearInterval(timer)
  }, speed)
  return () => clearInterval(timer)
}
