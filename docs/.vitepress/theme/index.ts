// The default VitePress theme, with wider pages (see custom.css) and a banner above every page naming the latest release.
import type { Theme } from "vitepress"
import DefaultTheme from "vitepress/theme"
import { h } from "vue"
import "./custom.css"

// Set at build time from package.json (vite.define in config.ts).
declare const __PLUGBOARD_LATEST__: string

const theme: Theme = {
  extends: DefaultTheme,
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      "layout-top": () =>
        h("div", { class: "version-banner" }, [
          `Latest release: v${__PLUGBOARD_LATEST__} · `,
          h("a", { href: "https://github.com/jjjermiah/opencode-plugboard/blob/main/CHANGELOG.md" }, "what's new"),
        ]),
    }),
}

export default theme
