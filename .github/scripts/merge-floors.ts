/**
 * Resolves a merge conflict in the ratcheting floor files by taking the higher value per key from
 * both sides (floors only go up). Run during a conflicted merge: `bun .github/scripts/merge-floors.ts`.
 */
import { $ } from "bun"

for (const file of [".github/floors/test-count-floors.json", ".github/floors/coverage-floor.json"]) {
  const side = async (stage: 2 | 3): Promise<Record<string, number> | undefined> => {
    const out = await $`git show :${stage}:${file}`.quiet().nothrow()
    return out.exitCode === 0 ? JSON.parse(out.stdout.toString()) : undefined
  }
  const [ours, theirs] = [await side(2), await side(3)]
  if (!ours || !theirs) continue
  const merged: Record<string, number> = {}
  for (const key of new Set([...Object.keys(ours), ...Object.keys(theirs)])) merged[key] = Math.max(ours[key] ?? 0, theirs[key] ?? 0)
  await Bun.write(file, `${JSON.stringify(merged, null, 2)}\n`)
  await $`git add ${file}`.quiet()
  console.log(`${file}: ${JSON.stringify(merged)}`)
}
