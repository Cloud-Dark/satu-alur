// Placeholder — replaced by the application shell implementation.
import * as StageDashboard from '../stages/dashboard.js'
export function renderShell(root, ctx) {
  const main = document.createElement('main')
  root.appendChild(main)
  StageDashboard.render(main)
}
