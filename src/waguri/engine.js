/**
 * Runs one question through a skill: the deterministic answer first (works offline,
 * no quota), then decides whether a model should phrase it.
 *
 * Policy: "Cek progres proyek" and "Ringkas keuangan" answer from the data only —
 * instant, exact and free. A model is asked when it adds something the rules cannot:
 * polishing a message draft, or a guide/public question the knowledge base does not
 * answer outright (it then gets the knowledge as BAHAN and may use only that).
 */
import { progressAnswer, financeAnswer, messageAnswer, knowledgeAnswer } from './answers.js'

/** True when this result should be phrased by a model (if one is reachable). */
export function wantsAi(skill, result) {
  if (!result?.ai?.context) return false
  if (skill.kind === 'message') return result.kind === 'draft'
  if (skill.kind === 'kb') return result.strong !== true
  return false
}

/**
 * loaders (app mode): { flow() -> { rows, ledger, pendingBookkeeping, invoices } }
 * loaders (public):   { plans() -> plans | null }
 */
export async function answerFor(skill, question, { mode, loaders = {}, sender = '', now = new Date() } = {}) {
  switch (skill.kind) {
    case 'progress': {
      const { rows } = await loaders.flow()
      return progressAnswer(rows, question)
    }
    case 'finance': {
      const { ledger, pendingBookkeeping, invoices } = await loaders.flow()
      return financeAnswer({ ledger, pendingBookkeeping, invoices, now })
    }
    case 'message': {
      const { rows } = await loaders.flow()
      return messageAnswer(rows, question, { sender })
    }
    default: {
      const plans = mode === 'public' && loaders.plans ? await loaders.plans().catch(() => null) : null
      return knowledgeAnswer(question, { mode, plans, only: skill.only })
    }
  }
}
