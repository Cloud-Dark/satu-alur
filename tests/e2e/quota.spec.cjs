// E2E: Paket & kuota on the mock cloud — trial quota bars, voucher redemption (bundle), the
// once-per-account rule, and the upsell dialog when an AI call hits a used-up quota without credit.
const { loginLive, goStage } = require('./lib.cjs')

const VOUCHERS = {
  next: 3,
  vouchers: [
    { id: 1, code: 'SATU-E2E-COMBO', type: 'bundle', plan_id: 2, plan_days: 30, credit_idr: 25000, max_redemptions: 10, redeemed_count: 0, expires_on: null, active: 1, note: '', created_at: '2026-10-30T00:00:00.000Z' },
    { id: 2, code: 'SATU-E2E-OLD', type: 'credit', plan_id: null, plan_days: null, credit_idr: 5000, max_redemptions: null, redeemed_count: 0, expires_on: '2020-01-01', active: 1, note: '', created_at: '2026-10-30T00:00:00.000Z' },
  ],
}
const PLANS = { next: 3, plans: [
  { id: 1, slug: 'free', name: 'Free', price_idr: 0, period: 'month', period_label: '', recommended: 0, badge: '', limits: [], features: [], quota: { offer: 10, report: 10, leads: 10, radar: 10, advisor: 5, social: 10 }, cta_label: 'Mulai', cta_kind: 'signup', sort: 1, active: 1 },
  { id: 2, slug: 'lite', name: 'Lite', price_idr: 99000, period: 'month', period_label: '', recommended: 1, badge: '', limits: [], features: [], quota: { offer: 50, report: 20, leads: 20, radar: 30, advisor: 2, social: 60 }, cta_label: 'Pilih Lite', cta_kind: 'signup', sort: 2, active: 1 },
] }

module.exports = async function quota(t) {
  const p = await t.page()
  await p.goto(`${t.base}/#/`)
  await p.evaluate(({ v, pl }) => {
    localStorage.setItem('satualur_quota_demo_v1', JSON.stringify({ usage: {}, credits: {}, entries: [], redemptions: [], ...v }))
    localStorage.setItem('satualur_business_demo_v1', JSON.stringify(pl))
  }, { v: VOUCHERS, pl: PLANS })
  await loginLive(p, t.base, 'kuota@usaha.id')
  t.check(await goStage(p, 'plan'), 'sidebar has "Paket & kuota"')
  await p.waitForSelector('.qt-rows')
  const rows = (await p.locator('.qt-row').allTextContents()).map((x) => x.replace(/\s+/g, ' ').trim())
  t.check(rows.length === 6 && rows.some((r) => /Penawaran AI.*0 \/ 10 draf/.test(r)) && rows.some((r) => /Penasihat AI.*0 \/ 5 pesan/.test(r)), 'Free trial quota: six features, 10 each, advisor 5', rows.join(' | '))
  t.check(/Free/.test(await p.locator('.qt-plan-name').textContent()) && /Rp0/.test(await p.locator('.qt-credit').textContent()), 'starts on Free with Rp0 AI credit')
  t.check(await p.locator('.lp-tier').count() === 2, 'the active plans are listed on the page')

  const redeem = async (code) => {
    await p.fill('#qt-voucher-code', code)
    await p.getByRole('button', { name: 'Tukar voucher' }).click()
    await p.waitForTimeout(500)
  }
  await redeem('SATU-E2E-OLD')
  t.check((await p.locator('.qt-voucher-form .field-error').textContent()) === 'Voucher ini sudah kedaluwarsa.', 'an expired voucher is refused')
  await redeem('tidak-ada')
  t.check((await p.locator('.qt-voucher-form .field-error').textContent()) === 'Kode voucher tidak ditemukan.', 'an unknown code is refused')
  await redeem(' satu-e2e-combo ')
  await p.waitForFunction(() => /Lite/.test(document.querySelector('.qt-plan-name')?.textContent || ''), null, { timeout: 8000 })
  t.check(/Rp25\.000/.test(await p.locator('.qt-credit').textContent()) && /sampai/.test(await p.locator('.qt-plan').textContent()), 'bundle voucher: Lite with an end date + Rp25.000 credit')
  t.check(await p.locator('.toast', { hasText: 'Voucher berhasil ditukar' }).count() >= 1, 'success toast after redeeming')
  await redeem('SATU-E2E-COMBO')
  t.check((await p.locator('.qt-voucher-form .field-error').textContent()) === 'Anda sudah menukar voucher ini.', 'the same voucher twice is refused')

  // Lite advisor quota is 2 in this fixture: use both, then 300/message comes from the Rp25.000 credit.
  await p.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('satualur_quota_demo_v1'))
    const uid = Object.keys(db.credits)[0]
    const period = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 7)
    db.usage[uid] = { [period]: { advisor: 2 } }
    db.credits[uid] = 300
    localStorage.setItem('satualur_quota_demo_v1', JSON.stringify(db))
  })
  await goStage(p, 'advisor')
  await p.waitForSelector('#adv-question')
  const ask = async (q) => {
    await p.fill('#adv-question', q)
    await p.keyboard.press('Enter')
  }
  await ask('Bagaimana cara naik 2% bulan depan?')
  // the advisor ignores a new question while an answer is still streaming
  await p.waitForFunction(() => document.querySelector('#adv-question')?.getAttribute('aria-busy') === 'true', null, { timeout: 5000 }).catch(() => {})
  await p.waitForFunction(() => document.querySelector('#adv-question')?.getAttribute('aria-busy') === 'false', null, { timeout: 30000 })
  t.check(await p.locator('dialog.qt-upsell[open]').count() === 0, 'quota used up but credit left: the message goes through (no upsell)')
  const credit = await p.evaluate(() => Object.values(JSON.parse(localStorage.getItem('satualur_quota_demo_v1')).credits)[0])
  t.check(credit === 0, 'one advisor message spent Rp300 of credit', String(credit))
  await ask('Biaya mana yang bisa dihemat?')
  await p.waitForSelector('dialog.qt-upsell[open]', { timeout: 10000 })
  t.check(/Penasihat AI/.test(await p.locator('dialog.qt-upsell').textContent()), 'no quota and no credit: the upsell dialog names the feature')
  t.check(await p.locator('dialog.qt-upsell').getByRole('link', { name: 'Hubungi kami' }).getAttribute('href') === '#/kontak', 'upsell offers "Hubungi kami"')
  await p.locator('dialog.qt-upsell').getByRole('button', { name: 'Tukar voucher' }).click()
  await p.waitForTimeout(800)
  t.check(await p.evaluate(() => document.querySelector('.flow-item[aria-current="page"]')?.dataset.stage) === 'plan' && await p.evaluate(() => document.activeElement?.id) === 'qt-voucher-code', '"Tukar voucher" opens Paket & kuota with the code box focused')
  const adv = (await p.locator('.qt-row', { hasText: 'Penasihat AI' }).textContent()).replace(/\s+/g, ' ')
  t.check(/2 \/ 2 pesan/.test(adv) && /Kuota habis/.test(adv), 'the advisor bar shows the used-up quota', adv)

  await p.setViewportSize({ width: 360, height: 800 })
  await p.waitForTimeout(300)
  t.check(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '360px: Paket & kuota has no horizontal scroll')
  await t.noErrors(p)
}
