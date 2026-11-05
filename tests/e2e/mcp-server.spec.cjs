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
  await p.waitForSelector('#mcp-token-label', { timeout: 8000 })
  t.check(await p.getAttribute('.drawer .seg-btn[data-value="ai-access"]', 'aria-checked') === 'true', '?bagian=mcp selects the Akses AI (MCP) tab')
  t.check(await p.locator('.drawer', { hasText: 'Token memberi akses baca' }).count() === 1, 'warns that a token gives read access')
  t.check(await p.locator('.aimcp-empty').count() === 1, 'no tokens yet')

  // Create
  await p.fill('#mcp-token-label', 'Laptop kantor')
  await p.getByRole('button', { name: 'Buat token' }).click()
  await p.waitForSelector('.aimcp-reveal', { timeout: 5000 })
  const token = (await p.textContent('[data-copy="token"]')).trim()
  t.check(/^sa_mcp_[A-Za-z0-9_-]{43}$/.test(token), 'token shown once in the sa_mcp_ format', token)
  const origin = await p.evaluate(() => location.origin)
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
  await t.noErrors(p)
}
