/**
 * Maintainer and test pages. They live in docs/ next to the code they describe but are not part of the user site: config.ts
 * leaves them out of the build (`srcExclude`), and the examples check ignores them when it asks whether a docs page uses an example.
 */
export const MAINTAINER_PAGES: readonly string[] = [
  "architecture.md",
  "best-practices.md",
  "compatibility.md",
  "development.md",
  "examples.md",
  "live-matrix.md",
  "packaging.md",
  "red-team.md",
  "releasing.md",
  "review-bot.md",
  "security-reviews.md",
]
