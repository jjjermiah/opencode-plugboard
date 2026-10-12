/**
 * Live cells that fail today, keyed by model (every cell of it) or by `model|endpoint|scenario`. Each
 * runs as `test.failing`, so it must keep failing; a fix or a restored provider turns it red, and then
 * the entry is removed. The reason says what was observed (see docs/live-matrix.md).
 */
export const KNOWN: Record<string, string> = {
  "openai/gpt-5.6-luna#low":
    "environment, not plugboard: the ChatGPT account hit its usage limit (subscription_sharing_usage_limit_exceeded); now answered as 429 quota_exceeded (#171)",
}
