/**
 * Live cells that fail today, keyed by model (every cell of it) or by `model|endpoint|scenario`. Each
 * runs as `test.failing`, so it must keep failing; a fix or a restored provider turns it red, and then
 * the entry is removed. The reason says what was observed (see docs/live-matrix.md).
 */
export const KNOWN: Record<string, string> = {
  "openai/gpt-5.6-luna#low":
    "environment, not plugboard: the ChatGPT account hit its usage limit (subscription_sharing_usage_limit_exceeded); now answered as 429 quota_exceeded (#171)",
  "anthropic/claude-haiku-4-5|chat|tools-json":
    "finding, intermittent: failed in 5 of 6 runs (passed once): the model answers in text instead of calling the respond tool, so plugboard returns 502 'finished without calling the respond tool'",
  "anthropic/claude-haiku-4-5|responses|tools-json": "finding: same respond-tool 502 as chat tools-json",
  "anthropic/claude-haiku-4-5|gemini|tools-json": "finding: same respond-tool 502 as chat tools-json",
}
