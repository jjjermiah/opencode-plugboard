// The default VitePress theme with a quieter look (custom.css) and the home diagram (Layout.vue).
// The latest release is a nav item (config.ts). Snippet / Full config tabs share one choice per reader (config-tabs.ts).
import type { Theme } from "vitepress"
import DefaultTheme from "vitepress/theme"
import { useConfigTabs } from "./config-tabs"
import Layout from "./Layout.vue"
import "./custom.css"

const theme: Theme = { extends: DefaultTheme, Layout, setup: useConfigTabs }

export default theme
