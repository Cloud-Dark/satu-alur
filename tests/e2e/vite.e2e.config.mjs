// Vite config for the e2e run: the project config plus HMR off, so edits made to
// src/ while the suite runs (other people/agents working) do not reload the page
// and drop the in-memory mock session mid-spec.
import base from '../../vite.config.js'

export default {
  ...base,
  server: { ...(base.server || {}), hmr: false, watch: null },
}
