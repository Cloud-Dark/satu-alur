// E2E: Pengaturan › Akses AI (MCP) — make a token (shown once with claude.ai / Claude Code /
// Claude Desktop instructions), list shows only the prefix, revoke with an inline confirm,
// deep link #/app/pengaturan?bagian=mcp. Mock mode: tokens are simulated by src/mock/mock-cloud.js.
const { loginLive } = require('./lib.cjs')

module.exports = async function mcpServer(t) {
  const p = await t.page()
  await p.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {})
  await loginLive(p, t.base)

  // Deep link opens the drawer on the Akses AI tab
  await p.evaluate(() => { location.hash = '#/app/pengaturan?bagian=mcp' })
  await p.waitForSelector('.drawer.is-open', { timeout: 5000 })
  await p.waitForSelector('.aimcp-login', { timeout: 8000 })
  t.check(await p.getAttribute('.drawer .seg-btn[data-value="ai-access"]', 'aria-checked') === 'true', '?bagian=mcp selects the Akses AI (MCP) tab')

  // Primary: the login flow (OAuth), nothing to copy but the server URL
  const origin = await p.evaluate(() => location.origin)
  t.check((await p.textContent('[data-copy="server-url"]')).trim() === `${origin}/mcp`, 'login flow shows <origin>/mcp')
  t.check(await p.locator('.aimcp-login', { hasText: 'Add custom connector' }).count() === 1, 'claude.ai steps for the login flow')
  t.check(await p.locator('.aimcp-login', { hasText: 'Izinkan' }).count() === 1, 'login steps end with Izinkan')
  t.check((await p.textContent('[data-copy="claude-code-login"]')).trim() === `claude mcp add --transport http satu-alur ${origin}/mcp`, 'Claude Code command without a token')
  t.check(await p.locator('.aimcp-grants-empty').count() === 1, 'no connected apps yet')
  // Manual tokens are collapsed under "Cara lain"
  const adv = p.locator('details.aimcp-advanced')
  t.check(await adv.count() === 1 && !(await adv.evaluate((d) => d.open)), 'manual tokens collapsed by default')
  t.check(!(await p.locator('#mcp-token-label').isVisible()), 'token form hidden until expanded')
  await p.click('details.aimcp-advanced > summary')
  await p.waitForSelector('#mcp-token-label', { timeout: 5000 })
  t.check(await p.locator('.drawer', { hasText: 'Token memberi akses baca' }).count() === 1, 'warns that a token gives read access')
  t.check(await p.locator('.aimcp-empty').count() === 1, 'no tokens yet')

  // Create
  await p.fill('#mcp-token-label', 'Laptop kantor')
  await p.getByRole('button', { name: 'Buat token' }).click()
  await p.waitForSelector('.aimcp-reveal', { timeout: 5000 })
  const token = (await p.textContent('[data-copy="token"]')).trim()
  t.check(/^sa_mcp_[A-Za-z0-9_-]{43}$/.test(token), 'token shown once in the sa_mcp_ format', token)
  t.check((await p.textContent('[data-copy="connector"]')).trim() === `${origin}/mcp/${token}`, 'claude.ai connector URL = <origin>/mcp/<token>')
  t.check(await p.locator('.aimcp-reveal', { hasText: 'Add custom connector' }).count() === 1, 'claude.ai steps shown')
  const cc = (await p.textContent('[data-copy="claude-code"]')).trim()
  t.check(cc === `claude mcp add --transport http satu-alur ${origin}/mcp --header "Authorization: Bearer ${token}"`, 'Claude Code command', cc)
  const desktop = JSON.parse(await p.textContent('[data-copy="desktop"]'))
  t.check(desktop.mcpServers['satu-alur'].command === 'npx' && desktop.mcpServers['satu-alur'].args.includes('mcp-remote')
    && desktop.mcpServers['satu-alur'].args.includes(`${origin}/mcp/${token}`), 'Claude Desktop JSON uses npx mcp-remote <url>')
  await p.click('[data-copy-btn="connector"]')
  const clip = await p.evaluate(() => navigator.clipboard.readText()).catch(() => null)
  if (clip !== null) t.check(clip === `${origin}/mcp/${token}`, 'copy button copies the connector URL')

  const row = p.locator('.aimcp-row', { hasText: 'Laptop kantor' })
  t.check(await row.count() === 1, 'new token listed with its label')
  t.check(await row.locator('.aimcp-prefix').textContent() === `${token.slice(0, 11)}…`, 'list shows only the prefix')
  t.check(!(await p.locator('.aimcp-list').textContent()).includes(token), 'list never shows the full token')

  // Hide the token: it cannot be seen again
  await p.getByRole('button', { name: 'Selesai, sudah disalin' }).click()
  t.check(await p.locator('.aimcp-reveal').count() === 0, 'token hidden after "Selesai"')
  t.check(!(await p.locator('.drawer').textContent()).includes(token), 'token no longer anywhere in the drawer')

  // Reopen the tab: still listed, still only the prefix
  await p.click('.drawer .seg-btn[data-value="agent"]')
  await p.click('.drawer .seg-btn[data-value="ai-access"]')
  await p.waitForSelector('.aimcp-row', { timeout: 5000 })
  t.check(await p.locator('.aimcp-row').count() === 1, 'token persists across tab switches')
  t.check(await adv.evaluate((d) => d.open), 'manual section opens by itself when tokens exist')

  // Revoke: inline confirm, cancel first
  await p.getByRole('button', { name: 'Cabut token Laptop kantor' }).click()
  await p.getByRole('button', { name: 'Batal' }).click()
  t.check(await p.locator('.aimcp-row').count() === 1, 'Batal keeps the token')
  await p.getByRole('button', { name: 'Cabut token Laptop kantor' }).click()
  await p.getByRole('button', { name: 'Ya, cabut' }).click()
  await p.waitForSelector('.aimcp-empty', { timeout: 5000 })
  t.check(await p.locator('.aimcp-row').count() === 0, 'revoked token removed from the list')

  // Mobile width: no horizontal overflow with a token shown
  await p.setViewportSize({ width: 390, height: 844 })
  await p.getByRole('button', { name: 'Buat token' }).click()
  await p.waitForSelector('.aimcp-reveal', { timeout: 5000 })
  const overflow = await p.evaluate(() => { const d = document.querySelector('.drawer-body') || document.querySelector('.drawer'); return d.scrollWidth - d.clientWidth })
  t.check(overflow <= 1, 'no horizontal scroll on a phone', overflow)
  t.check(await p.locator('.aimcp-row', { hasText: 'Claude' }).count() === 1, 'empty label defaults to "Claude"')

  // Connected apps (OAuth grants): approve one in the mock, it is listed, then "Putuskan"
  await p.setViewportSize({ width: 1440, height: 900 })
  await p.evaluate(async () => {
    const { getCloud } = await import('/src/cloud.js')
    const o = getCloud().aiOAuth
    await o.decide(o.startRequest({ client_name: 'Claude', state: 's1' }), true)
  })
  await p.click('.drawer .seg-btn[data-value="agent"]')
  await p.click('.drawer .seg-btn[data-value="ai-access"]')
  await p.waitForSelector('.aimcp-grant', { timeout: 5000 })
  const grant = p.locator('.aimcp-grant')
  t.check(await grant.count() === 1, 'approved app listed under Aplikasi terhubung')
  t.check((await grant.textContent()).includes('claude.ai') && (await grant.textContent()).includes('Terhubung sejak'), 'grant shows redirect host and since when', await grant.textContent())
  t.check((await grant.textContent()).includes('Belum pernah dipakai'), 'grant shows last use')
  await p.getByRole('button', { name: 'Putuskan Claude' }).click()
  await p.getByRole('button', { name: 'Batal' }).click()
  t.check(await p.locator('.aimcp-grant').count() === 1, 'Batal keeps the connection')
  await p.getByRole('button', { name: 'Putuskan Claude' }).click()
  await p.getByRole('button', { name: 'Ya, putuskan' }).click()
  await p.waitForSelector('.aimcp-grants-empty', { timeout: 5000 })
  t.check(await p.locator('.aimcp-grant').count() === 0, 'Putuskan removes the connection')
  await t.noErrors(p)
}
