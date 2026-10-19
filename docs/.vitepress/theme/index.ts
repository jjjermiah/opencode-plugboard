// The default VitePress theme with a quieter look (custom.css) and the home diagram (Layout.vue).
// The latest release is a nav item (config.ts).
import type { Theme } from "vitepress"
import DefaultTheme from "vitepress/theme"
import Layout from "./Layout.vue"
import "./custom.css"

const theme: Theme = { extends: DefaultTheme, Layout }

export default theme
