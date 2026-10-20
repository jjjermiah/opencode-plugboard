<script setup lang="ts">
// The default layout. A page with `homeHero: true` in its front matter gets the hero above the docs layout, so the
// sidebar and the content start on the home page itself (custom.css, "Home").
import DefaultTheme from "vitepress/theme"
import { useData } from "vitepress"
import HomeHero from "./HomeHero.vue"

const { Layout } = DefaultTheme
const { frontmatter } = useData()
</script>

<template>
  <Layout>
    <template #layout-top>
      <HomeHero v-if="frontmatter.homeHero" />
    </template>
  </Layout>
</template>
