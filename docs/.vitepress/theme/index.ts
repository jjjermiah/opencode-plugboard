// The default VitePress theme, with wider pages (see custom.css) and a banner above every page. The
// docs deploy from main, so they can describe options the latest release does not have.
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
          `These docs follow main; the latest release is v${__PLUGBOARD_LATEST__} (see `,
          h("a", { href: "https://github.com/jjjermiah/opencode-plugboard/blob/main/CHANGELOG.md" }, "changelog"),
          ").",
        ]),
    }),
}

export default theme
