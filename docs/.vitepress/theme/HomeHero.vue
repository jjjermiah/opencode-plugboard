<script setup lang="ts">
// The home page's top: a plain serif headline, one install command in a copyable box, two small links and a framed
// terminal. It sits above the normal docs layout (Layout.vue puts it in the `layout-top` slot).
import { useClipboard, useElementBounding } from "@vueuse/core"
import { onBeforeUnmount, onMounted, ref, watch } from "vue"
import HomeTerminal from "./HomeTerminal.vue"

const repo = "https://github.com/jjjermiah/opencode-plugboard"
const npm = "https://www.npmjs.com/package/opencode-plugboard"
const command = "bunx opencode-plugboard init"

const { copy, copied } = useClipboard({ source: command, copiedDuring: 1600, legacy: true })

// The sidebar starts under the hero and then sticks under the top bar: custom.css translates it by --plug-hero-bottom,
// set on the sidebar only (a transform is not a layout shift, and no other element restyles on scroll).
// While the hero is behind the top bar, the bar drops its hairlines (class plug-hero-visible).
const hero = ref<HTMLElement>()
const { bottom } = useElementBounding(hero)
const sidebar = () => document.querySelector<HTMLElement>(".VPSidebar")
onMounted(() =>
  watch(
    bottom,
    (value) => {
      sidebar()?.style.setProperty("--plug-hero-bottom", `${Math.round(value)}px`)
      document.documentElement.classList.toggle("plug-hero-visible", value > 64)
    },
    { immediate: true },
  ),
)
onBeforeUnmount(() => {
  sidebar()?.style.removeProperty("--plug-hero-bottom")
  document.documentElement.classList.remove("plug-hero-visible")
})
</script>

<template>
  <section ref="hero" class="plug-hero">
    <div class="text">
      <h1>
        <span>Your OpenCode logins</span>
        <span>as an API.</span>
      </h1>
      <p class="lede">OpenAI, Anthropic and Gemini compatible apps call plugboard with their own key and use the models you already have in OpenCode.</p>
      <button type="button" class="install" aria-label="Copy the install command" @click="copy()">
        <span class="dollar" aria-hidden="true">$</span>
        <code>{{ command }}</code>
        <span class="copy-icon" :class="{ done: copied }" aria-hidden="true" />
        <span class="sr-only" role="status">{{ copied ? "Copied" : "" }}</span>
      </button>
      <p class="links">
        <!-- The marks are simple-icons paths (CC0), inline so the page makes no icon request. -->
        <a :href="repo">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 .297c-6.63 0-12 5.373-12 12c0 5.303 3.438 9.8 8.205 11.385c.6.113.82-.258.82-.577c0-.285-.01-1.04-.015-2.04c-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729c1.205.084 1.838 1.236 1.838 1.236c1.07 1.835 2.809 1.305 3.495.998c.108-.776.417-1.305.76-1.605c-2.665-.3-5.466-1.332-5.466-5.93c0-1.31.465-2.38 1.235-3.22c-.135-.303-.54-1.523.105-3.176c0 0 1.005-.322 3.3 1.23c.96-.267 1.98-.399 3-.405c1.02.006 2.04.138 3 .405c2.28-1.552 3.285-1.23 3.285-1.23c.645 1.653.24 2.873.12 3.176c.765.84 1.23 1.91 1.23 3.22c0 4.61-2.805 5.625-5.475 5.92c.42.36.81 1.096.81 2.22c0 1.606-.015 2.896-.015 3.286c0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" /></svg>
          GitHub
        </a>
        <a :href="npm">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M1.763 0C.786 0 0 .786 0 1.763v20.474C0 23.214.786 24 1.763 24h20.474c.977 0 1.763-.786 1.763-1.763V1.763C24 .786 23.214 0 22.237 0zM5.13 5.323l13.837.019l-.009 13.836h-3.464l.01-10.382h-3.456L12.04 19.17H5.113z" /></svg>
          npm
        </a>
      </p>
    </div>
    <HomeTerminal />
  </section>
</template>

<style scoped>
.plug-hero {
  position: relative;
  overflow-x: clip;
  padding: 40px 24px 48px;
  text-align: center;
}

/* A dot field behind the hero. It fades out toward the sides and the bottom, and stops where the docs start. */
.plug-hero::before {
  content: "";
  position: absolute;
  inset: 0;
  background-image: radial-gradient(circle, var(--plug-dot) 1.2px, transparent 1.6px);
  background-size: 16px 16px;
  -webkit-mask-image: radial-gradient(ellipse 62% 78% at 50% 38%, #000 25%, transparent 78%);
  mask-image: radial-gradient(ellipse 62% 78% at 50% 38%, #000 25%, transparent 78%);
  pointer-events: none;
}

.plug-hero > * {
  position: relative;
}

@media (min-width: 960px) {
  .plug-hero {
    padding-top: calc(var(--vp-nav-height) + 36px);
  }
}

h1 {
  margin: 0;
  font-family: var(--plug-serif);
  font-style: italic;
  font-weight: 400;
  font-size: clamp(42px, 9.5vw, 72px);
  line-height: 1.04;
  letter-spacing: -0.012em;
  color: var(--vp-c-text-1);
  text-wrap: balance;
}

h1 span {
  display: block;
  white-space: nowrap;
}

.lede {
  margin: 18px auto 0;
  max-width: 620px;
  font-size: 17px;
  line-height: 1.55;
  color: var(--vp-c-text-2);
  text-wrap: balance;
}

.install {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 12px;
  margin-top: 24px;
  padding: 11px 16px 11px 20px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 0;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  font: 15px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  cursor: pointer;
  transition: border-color 0.15s;
}

.install:hover,
.install:focus-visible {
  border-color: var(--vp-c-text-3);
}

.install code {
  padding: 0;
  background: none;
  color: inherit;
  font: inherit;
}

.dollar {
  color: var(--vp-c-brand-1);
}

.copy-icon {
  width: 16px;
  height: 16px;
  background-color: var(--vp-c-text-3);
  -webkit-mask: var(--vp-icon-copy) center / contain no-repeat;
  mask: var(--vp-icon-copy) center / contain no-repeat;
}

.install:hover .copy-icon {
  background-color: var(--vp-c-text-1);
}

.copy-icon.done {
  background-color: var(--vp-c-green-1);
  -webkit-mask-image: var(--vp-icon-copied);
  mask-image: var(--vp-icon-copied);
}

.links {
  display: flex;
  justify-content: center;
  gap: 20px;
  margin: 14px 0 32px;
  font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.links a {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--vp-c-text-2);
  text-decoration: none;
  transition: color 0.15s;
}

.links a:hover {
  color: var(--vp-c-text-1);
}

.links svg {
  width: 15px;
  height: 15px;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

@media (max-width: 640px) {
  .plug-hero {
    padding: 40px 16px 48px;
  }

  .lede {
    font-size: 16px;
  }

  .install {
    font-size: 13px;
    padding: 10px 12px 10px 14px;
  }
}
</style>
