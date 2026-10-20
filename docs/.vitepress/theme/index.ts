// The default VitePress theme with a quieter look (custom.css) and the home diagram (Layout.vue).
// The latest release is a nav item (config.ts). Snippet / Full config tabs are vitepress-plugin-tabs groups sharing one key, so a
// reader's choice applies to every group and pages remember it.
import type { Theme } from "vitepress"
import DefaultTheme from "vitepress/theme"
import { enhanceAppWithTabs } from "vitepress-plugin-tabs/client"
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
