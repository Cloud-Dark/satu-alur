export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag)
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === 'className') node.className = v
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v)
    else node.setAttribute(k, v)
  })
  children.forEach((c) => {
    if (c == null) return
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c)
  })
  return node
}

export function section(title, ...children) {
  return el('section', { className: 'card' },
    el('h2', {}, title),
    ...children
  )
}
