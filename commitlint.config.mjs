// Conventional Commits with a body on every commit. The bodies are the raw material of the
// release notes (.github/scripts/commit-detail.ts), so they are checked, not just encouraged.
// Format and examples: CONTRIBUTING.md#commits. Enforced by lefthook (commit-msg) and by the
// "Commits" workflow for every commit after the cutoff.

// Types whose commits change what the package does or how it is built. They need a real
// explanation, not a one-line afterthought.
const SUBSTANTIVE = ["feat", "fix", "perf", "refactor", "security"]
const MIN_BODY = 150

export default {
  extends: ["@commitlint/config-conventional"],
  plugins: [
    {
      rules: {
        // commitlint's own body-min-length applies to every type; this one takes a type list.
        "body-min-length-for-types": (parsed, when = "always", { types, min }) => {
          if (!types.includes(parsed.type)) return [true]
          const length = (parsed.body ?? "").trim().length
          const ok = length >= min
          return [
            when === "always" ? ok : !ok,
            `a ${parsed.type} commit body needs at least ${min} characters (what changed, why, alternatives rejected, how it was checked, issue refs), found ${length}`,
          ]
        },
      },
    },
  ],
  rules: {
    "type-enum": [
      2,
      "always",
      ["build", "chore", "ci", "docs", "feat", "fix", "perf", "refactor", "revert", "security", "style", "test"],
    ],
    // Scopes are optional; an unknown one only warns, so a new area does not block a commit.
    "scope-enum": [
      1,
      "always",
      [
        "openai", "responses", "anthropic", "gemini", "completions", "session", "runtime", "http",
        "config", "metrics", "discovery", "cache", "fallback", "tests", "ci", "docs", "changelog", "deps",
      ],
    ],
    "body-empty": [2, "never"],
    "body-leading-blank": [2, "always"],
    "body-min-length-for-types": [2, "always", { types: SUBSTANTIVE, min: MIN_BODY }],
  },
  // Release commits are written by .github/scripts/release.ts. Merge commits are ignored by
  // commitlint's defaults.
  ignores: [(message) => /^chore\(release\): \d/.test(message)],
  helpUrl: "https://github.com/jjjermiah/opencode-plugboard/blob/main/CONTRIBUTING.md#commits",
}
