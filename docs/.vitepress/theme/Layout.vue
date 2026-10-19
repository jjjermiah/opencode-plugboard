<script setup lang="ts">
// The default layout plus the home page's framed diagram under the hero (index.md has no image field).
// Each theme has a wide and a narrow (phone) drawing.
import DefaultTheme from "vitepress/theme"
import { withBase } from "vitepress"

const { Layout } = DefaultTheme
const alt =
  "Apps call plugboard with the OpenAI, Anthropic or Gemini API. Plugboard runs inside your OpenCode server, turns each request into an OpenCode session and uses your provider logins: Claude, ChatGPT, GitHub Copilot and OpenCode Go."
</script>

<template>
  <Layout>
    <template #home-hero-after>
      <figure class="hero-figure">
        <picture class="only-light">
          <source media="(max-width: 640px)" :srcset="withBase('/hero-mobile-light.svg')" />
          <img :src="withBase('/hero-light.svg')" width="1000" height="380" :alt="alt" />
        </picture>
        <picture class="only-dark">
          <source media="(max-width: 640px)" :srcset="withBase('/hero-mobile-dark.svg')" />
          <img :src="withBase('/hero-dark.svg')" width="1000" height="380" alt="" aria-hidden="true" />
        </picture>
      </figure>
    </template>
  </Layout>
</template>
