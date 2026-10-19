/**
 * #411 Replay of signed reasoning. plugboard rewrites tool placeholder ids in the reasoning it returns
 * (src/tool-placeholders.ts), so the text a caller sends back differs from the text the provider signed.
 * Anthropic checks a replayed thinking block against its signature (a modified block is a 400), so the
 * original text is kept here per signature, and restored when that signature comes back.
 *
 * The map lives in this process and is bounded (1000 blocks, 8M characters). A signature it no longer
 * holds, after a restart or an eviction, replays as the caller sent it.
 */
import { LRUCache } from "lru-cache"

const ORIGINAL = new LRUCache<string, string>({ max: 1000, maxSize: 8 * 1024 * 1024, sizeCalculation: (text) => text.length })

/** Keep the reasoning text a signature was made for, when the text returned to the caller was rewritten. */
export function rememberReasoning(signature: string, text: string): void {
  ORIGINAL.set(signature, text)
}

/** The text to replay for a signed block: the original when it is known, else the text as received. */
export function replayedReasoning(signature: string, text: string): string {
  return ORIGINAL.get(signature) ?? text
}
