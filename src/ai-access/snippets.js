/**
 * Akses AI (MCP): the connection instructions shown once after a token is made (pure; no I/O).
 * host = window.location.origin of the app (the Worker serves /mcp on the same origin).
 */

export const SERVER_NAME = 'satu-alur'

const trimHost = (host) => String(host || '').replace(/\/+$/, '')

/** URL for a claude.ai custom connector (it only takes a URL, so the token goes in the path). */
export const connectorUrl = (host, token) => `${trimHost(host)}/mcp/${token}`

/** Claude Code: header form, so the token is not part of the URL. */
export const claudeCodeCommand = (host, token) =>
  `claude mcp add --transport http ${SERVER_NAME} ${trimHost(host)}/mcp --header "Authorization: Bearer ${token}"`

/** Claude Desktop (claude_desktop_config.json) through the mcp-remote bridge. */
export const desktopConfig = (host, token) => JSON.stringify({
  mcpServers: { [SERVER_NAME]: { command: 'npx', args: ['-y', 'mcp-remote', connectorUrl(host, token)] } },
}, null, 2)

/** Login flow (OAuth): the bare server URL; Claude finds the login page itself. */
export const serverUrl = (host) => `${trimHost(host)}/mcp`

/** Claude Code with login: add the server, then /mcp -> Authenticate in Claude Code. */
export const claudeCodeLoginCommand = (host) => `claude mcp add --transport http ${SERVER_NAME} ${serverUrl(host)}`

/** All three snippets for one token. */
export function snippets(host, token) {
  return {
    connector: connectorUrl(host, token),
    claudeCode: claudeCodeCommand(host, token),
    desktop: desktopConfig(host, token),
  }
}
