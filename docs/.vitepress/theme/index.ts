// The default VitePress theme, with wider pages (see custom.css). The latest release is a nav item (config.ts).
import type { Theme } from "vitepress"
import DefaultTheme from "vitepress/theme"
import "./custom.css"

const theme: Theme = { extends: DefaultTheme }

export default theme
