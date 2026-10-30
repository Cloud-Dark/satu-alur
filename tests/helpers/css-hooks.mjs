// Node module hooks: stub out browser-only asset imports (e.g. `import './x.css'`)
// so pure modules that transitively import UI code can be loaded under node:test.
const ASSET = /\.(css|svg|png|jpe?g|gif|webp|woff2?)(\?.*)?$/i

export async function load(url, context, nextLoad) {
  if (ASSET.test(url)) {
    return { format: 'module', source: 'export default ""', shortCircuit: true }
  }
  return nextLoad(url, context)
}
