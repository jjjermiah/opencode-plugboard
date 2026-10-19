// The Snippet / Full config tabs (docs/.vitepress/full-config.ts) are code groups, and VitePress keeps each group on its own.
// Picking a tab here picks it in every group on the page, and the choice is kept in localStorage for the next page.
import { inBrowser, onContentUpdated } from "vitepress"
import { onMounted } from "vue"

const KEY = "plugboard-config-tab"
const TABS = ["Snippet", "Full config"]

const stored = (): string | null => {
  try {
    const value = localStorage.getItem(KEY)
    return value && TABS.includes(value) ? value : null
  } catch {
    return null // storage can be blocked
  }
}

/** The tab input labelled `title` in each group that has the Snippet and Full config pair. */
function inputs(title: string): HTMLInputElement[] {
  const found: HTMLInputElement[] = []
  for (const group of document.querySelectorAll<HTMLElement>(".vp-code-group")) {
    const labels = Array.from(group.querySelectorAll<HTMLLabelElement>(".tabs label"))
    if (!TABS.every((tab) => labels.some((label) => label.dataset.title === tab))) continue
    const label = labels.find((l) => l.dataset.title === title)
    const input = label && group.querySelector<HTMLInputElement>(`input[id="${label.htmlFor}"]`)
    if (input) found.push(input)
  }
  return found
}

/** Click the tab in each group where it is not already shown. VitePress's own click handler then swaps the block. */
function show(title: string) {
  for (const input of inputs(title)) if (!input.checked) input.click()
}

let listening = false
let applying = false

export function useConfigTabs() {
  const apply = () => {
    const title = stored()
    if (!title) return
    applying = true
    try {
      show(title)
    } finally {
      applying = false
    }
  }
  onMounted(() => {
    if (!inBrowser || listening) return
    listening = true
    window.addEventListener("click", (event) => {
      const el = event.target as HTMLElement | null
      if (applying || !el?.matches?.(".vp-code-group input")) return
      const title = el.parentElement?.querySelector<HTMLLabelElement>(`label[for="${el.id}"]`)?.dataset.title
      if (!title || !TABS.includes(title)) return
      try {
        localStorage.setItem(KEY, title)
      } catch {
        // not saved, still shown on this page
      }
      applying = true
      try {
        show(title)
      } finally {
        applying = false
      }
    })
  })
  onMounted(apply)
  onContentUpdated(apply)
}
