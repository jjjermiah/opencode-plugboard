// The default VitePress theme with a quieter look (custom.css) and the home hero (Layout.vue).
// The headline font is self-hosted from npm (no font CDN). The latest release is a nav item (config.ts). Snippet / Full config tabs are vitepress-plugin-tabs groups sharing one key, so a
// reader's choice applies to every group and pages remember it.
import type { Theme } from "vitepress"
import DefaultTheme from "vitepress/theme"
import { enhanceAppWithTabs } from "vitepress-plugin-tabs/client"
import "@fontsource/instrument-serif/latin-400-italic.css"
import Layout from "./Layout.vue"
import "./custom.css"

const theme: Theme = {
  extends: DefaultTheme,
  Layout,
  enhanceApp({ app }) {
    enhanceAppWithTabs(app)
  },
}

export default theme
