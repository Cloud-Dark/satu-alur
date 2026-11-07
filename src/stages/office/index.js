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
import * as Vouchers from './vouchers.js'
import * as OfferTemplates from './offer-templates.js'
import * as System from './system.js'
import { adminContactCounts, adminTicketCounts } from '../../customers/api.js'
import { t } from '../../i18n/index.js'

const { el } = C

// Single source of the staff menu: the shell turns each section into a sidebar item.
export const GROUPS = [
  { title: t('office.menu.groupSite'), items: [
    { key: 'landing', label: t('office.menu.landing'), icon: 'home', draw: Landing.draw },
    { key: 'about', label: t('office.menu.about'), icon: 'building', draw: Doc.drawAbout },
    { key: 'legal', label: t('office.menu.legal'), icon: 'file', draw: Doc.drawLegal }] },
  { title: t('office.menu.groupBusiness'), items: [
    { key: 'plans', label: t('office.menu.plans'), icon: 'ledger', draw: Plans.draw },
    { key: 'gateway', label: t('office.menu.gateway'), icon: 'wallet', draw: Payment.draw },
    { key: 'vouchers', label: t('office.menu.vouchers'), icon: 'receipt', draw: Vouchers.draw },
    { key: 'offer-templates', label: t('office.menu.offerTemplates'), icon: 'fileText', draw: OfferTemplates.draw }] },
  { title: t('office.menu.groupCustomers'), items: [
    { key: 'customers', label: t('office.menu.customers'), icon: 'users', draw: Customers.draw },
    { key: 'users', label: t('office.menu.users'), icon: 'shield', draw: Users.draw },
    { key: 'contact', label: t('office.menu.contact'), icon: 'mail', draw: Contact.draw },
    { key: 'tickets', label: t('office.menu.tickets'), icon: 'message', draw: Support.draw }] },
  { title: t('office.menu.groupAgency'), items: [
    { key: 'influencers', label: t('office.menu.influencers'), icon: 'sparkles', draw: Influencers.draw },
    { key: 'requests', label: t('office.menu.requests'), icon: 'inbox', draw: Requests.draw },
    { key: 'campaigns', label: t('office.menu.campaigns'), icon: 'megaphone', draw: Campaigns.draw }] },
  { title: t('office.menu.groupSystem'), items: [
    { key: 'sys-overview', label: t('office.menu.sysOverview'), icon: 'chart', draw: System.drawOverview },
    { key: 'sys-email', label: t('office.menu.sysEmail'), icon: 'mail', draw: System.drawEmail },
    { key: 'sys-ai', label: t('office.menu.sysAi'), icon: 'sparkles', draw: System.drawAi },
    { key: 'sys-login', label: t('office.menu.sysLogin'), icon: 'lock', draw: System.drawLogin },
    { key: 'sys-access', label: t('office.menu.sysAccess'), icon: 'shield', draw: System.drawAccess },
    { key: 'sys-whatsapp', label: t('office.menu.sysWhatsapp'), icon: 'plug', draw: System.drawWhatsapp },
    { key: 'sys-activity', label: t('office.menu.sysActivity'), icon: 'activity', draw: System.drawActivity }] },
]
export const ITEMS = GROUPS.flatMap((g) => g.items.map((i) => ({ ...i, group: g.title })))

// Sidebar badges: new Contact Us messages and tickets waiting on staff.
export async function badgeCounts() {
  const [contact, tickets] = await Promise.allSettled([adminContactCounts(), adminTicketCounts()])
  return { contact: contact.value?.new || 0, tickets: tickets.value?.open || 0 }
}
export const BADGE_TITLES = { contact: (n) => t('office.menu.badgeContact', { count: n }), tickets: (n) => t('office.menu.badgeTickets', { count: n }) }

/** Draws one section into the shell's view; ctx.setLeaveGuard / ctx.refreshBadges come from the shell. */
export function render(container, ctx, key) {
  let dirty = false
  ctx.setLeaveGuard(() => !dirty || confirm(Doc.LEAVE_MSG))
  const onUnload = (e) => { if (dirty) { e.preventDefault(); e.returnValue = '' } }
  window.addEventListener('beforeunload', onUnload)
  ctx.signal.addEventListener('abort', () => window.removeEventListener('beforeunload', onUnload))
  const item = ITEMS.find((i) => i.key === key)
  // Each visit has its own view, so a slow load from a left section lands in a detached box.
  const box = el('div', { className: 'of-content' })
  container.replaceChildren(el('h1', { className: 'sr-only' }, item.label), box)
  item.draw(box, ctx, (d) => { dirty = d }, ctx.refreshBadges)
}
