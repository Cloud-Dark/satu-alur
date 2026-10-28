// Placeholder — replaced by the growth tools implementation.
import * as C from '../ui/components.js'
export function render(container) {
  container.replaceChildren(C.el ? C.el('p', {}, 'Segera hadir.') : document.createTextNode('Segera hadir.'))
}
