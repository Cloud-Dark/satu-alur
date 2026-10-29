import * as C from '../../ui/components.js'
import * as Influencers from './influencers.js'
import * as Requests from './requests.js'

const { el } = C
const TABS = [{ value: 'influencers', label: 'Influencer' }, { value: 'requests', label: 'Permintaan' }]
let tab = 'influencers'

export async function render(container, ctx) {
  const host = el('div')
  const draw = () => (tab === 'influencers' ? Influencers : Requests).draw(host, ctx)
  const tabs = C.segmented({ options: TABS, value: tab, label: 'Kantor Satu Alur', onChange: (v) => { tab = v; draw() } })
  tabs.classList.add('workspace-tabs')
  container.replaceChildren(
    C.pageHeader({ title: 'Kantor Satu Alur', description: 'Kelola katalog influencer dan permintaan dari bisnis.' }), tabs, host)
  draw()
}
