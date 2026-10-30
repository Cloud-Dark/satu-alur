import * as C from '../../ui/components.js'
import * as Influencers from './influencers.js'
import * as Requests from './requests.js'
import * as Landing from './site-landing.js'
import * as Doc from './site-doc.js'
import * as Plans from './plans.js'
import * as Payment from './payment.js'
import * as Customers from './customers.js'
import * as Users from './users.js'
import * as Contact from './contact.js'
import * as Support from './support.js'
import * as Campaigns from './campaigns.js'
import { adminContactCounts, adminTicketCounts } from '../../customers/api.js'

const { el } = C

// Single source of the staff menu: the shell turns each section into a sidebar item.
export const GROUPS = [
  { title: 'Konten Situs', items: [
    { key: 'landing', label: 'Landing page', icon: 'home', draw: Landing.draw },
    { key: 'about', label: 'Tentang kami', icon: 'building', draw: Doc.drawAbout },
    { key: 'legal', label: 'Legal', icon: 'file', draw: Doc.drawLegal }] },
  { title: 'Bisnis', items: [
    { key: 'plans', label: 'Paket langganan', icon: 'ledger', draw: Plans.draw },
    { key: 'gateway', label: 'Payment gateway', icon: 'wallet', draw: Payment.draw }] },
  { title: 'Pelanggan', items: [
    { key: 'customers', label: 'Pelanggan & mitra', icon: 'users', draw: Customers.draw },
    { key: 'users', label: 'Pengguna', icon: 'shield', draw: Users.draw },
    { key: 'contact', label: 'Contact Us', icon: 'mail', draw: Contact.draw },
    { key: 'tickets', label: 'Pengaduan CS', icon: 'message', draw: Support.draw }] },
  { title: 'Agensi Influencer', items: [
    { key: 'influencers', label: 'Influencer', icon: 'sparkles', draw: Influencers.draw },
    { key: 'requests', label: 'Permintaan', icon: 'inbox', draw: Requests.draw },
    { key: 'campaigns', label: 'Kampanye', icon: 'megaphone', draw: Campaigns.draw }] },
]
export const ITEMS = GROUPS.flatMap((g) => g.items.map((i) => ({ ...i, group: g.title })))

// Sidebar badges: new Contact Us messages and tickets waiting on staff.
export async function badgeCounts() {
  const [contact, tickets] = await Promise.all([adminContactCounts(), adminTicketCounts()])
  return { contact: contact.new, tickets: tickets.open }
}
export const BADGE_TITLES = { contact: (n) => `${n} pesan baru`, tickets: (n) => `${n} tiket menunggu` }

/** Draws one section into the shell's view; ctx.setLeaveGuard / ctx.refreshBadges come from the shell. */
export function render(container, ctx, key) {
  let dirty = false
  ctx.setLeaveGuard(() => !dirty || confirm(Doc.LEAVE_MSG))
  const onUnload = (e) => { if (dirty) { e.preventDefault(); e.returnValue = '' } }
  window.addEventListener('beforeunload', onUnload)
  ctx.signal.addEventListener('abort', () => window.removeEventListener('beforeunload', onUnload))
  // The box is detached when the shell replaces the view, so a slow load from a left section never paints over the next one.
  const box = el('div', { className: 'of-content' })
  container.replaceChildren(box)
  ITEMS.find((i) => i.key === key).draw(box, ctx, (d) => { if (box.parentNode === container) dirty = d }, ctx.refreshBadges)
}
