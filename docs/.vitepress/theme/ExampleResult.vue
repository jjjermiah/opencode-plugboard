<script setup lang="ts">
// The latest results of one example, on a client page: the scripted run (CI) and the newest live run, with its scenario
// table. Read from examples.json, written from examples/*/runs before each docs build.
import { computed } from "vue"
import data from "../examples.json"
import type { ExampleEntry, ExampleRun } from "./examples-model"

const props = defineProps<{ example: string }>()
const entry = computed(() => (data as ExampleEntry[]).find((candidate) => candidate.name === props.example))
const repo = "https://github.com/jjjermiah/opencode-plugboard/tree/main/examples"
const linkOf = (run: ExampleRun) => `${repo}/${props.example}/${run.path}`
const dirOf = (run: ExampleRun) => run.path.split("/").pop()
const plugboardOf = (run: ExampleRun) => (run.plugboard ? `plugboard ${run.plugboard.version} (${run.plugboard.commit})` : "")
</script>

<template>
  <aside v-if="entry" class="example-result">
    <p>
      <strong>Scripted run (CI):</strong> {{ entry.scripted?.verdict ?? "not run" }}
      <template v-if="entry.scripted"> ·
        <a :href="`${repo}/${example}/runs/scripted`">runs/scripted</a>
      </template>
    </p>
    <p v-if="entry.newestLive">
      <strong>Newest live run:</strong>
      <a :href="linkOf(entry.newestLive)"><code>{{ dirOf(entry.newestLive) }}</code></a>,
      {{ entry.newestLive.date }}<template v-if="plugboardOf(entry.newestLive)">, <span>{{ plugboardOf(entry.newestLive) }}</span></template>,
      {{ entry.newestLive.verdict ?? "historical record" }}
      <template v-if="entry.newestLive.client"> ({{ entry.newestLive.client.name }} {{ entry.newestLive.client.version }})</template>
    </p>
    <table v-if="entry.newestLive && entry.newestLive.scenarios.length">
      <thead>
        <tr>
          <th>Scenario</th>
          <th>Model</th>
          <th>Variant</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, index) in entry.newestLive.scenarios" :key="index">
          <td>{{ row.id }}</td>
          <td>{{ row.model }}</td>
          <td>{{ row.variant ?? "" }}</td>
          <td>{{ row.status }}</td>
        </tr>
      </tbody>
    </table>
    <p v-else-if="entry.newestLive">This live run has only a REPORT.md (a historical record). See the directory above.</p>
  </aside>
</template>

<style scoped>
.example-result {
  margin: 1rem 0;
  font-size: 0.95em;
}
</style>
