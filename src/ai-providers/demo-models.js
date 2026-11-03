// Simulated model lists for the mock cloud (dev/e2e): no network.
export const DEMO_MODELS = {
  openai: ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4.1', 'o4-mini'].map((id) => ({ id, name: id })),
  anthropic: [
    { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5 (claude-haiku-4-5)' },
    { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5 (claude-sonnet-4-5)' },
    { id: 'claude-opus-4-1', name: 'Claude Opus 4.1 (claude-opus-4-1)' },
  ],
}
