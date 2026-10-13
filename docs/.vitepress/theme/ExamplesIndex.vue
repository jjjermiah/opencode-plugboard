<script setup lang="ts">
// Every example directory with its scripted verdict and newest live run, for the examples overview page (docs/examples.md).
import data from "../examples.json"
import type { ExampleEntry, ExampleRun } from "./examples-model"

const repo = "https://github.com/jjjermiah/opencode-plugboard/tree/main/examples"
/** The verdict as the table prints it. Kept here, not imported: examples-model reads files and is build-time only. */
const verdictCell = (run: ExampleRun | null): string => (run ? (run.verdict ?? "historical record") : "not run")
</script>

<template>
  <table class="examples-index">
    <thead>
      <tr>
        <th>Example</th>
        <th>Scripted</th>
        <th>Newest live run</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="entry in (data as ExampleEntry[])" :key="entry.name">
        <td><a :href="`${repo}/${entry.name}`">{{ entry.name }}/</a></td>
        <td>{{ verdictCell(entry.scripted) }}</td>
        <td>
          <template v-if="entry.newestLive">
            <a :href="`${repo}/${entry.name}/${entry.newestLive.path}`"><code>{{ entry.newestLive.path.split("/").pop() }}</code></a>,
            {{ entry.newestLive.date }}, {{ verdictCell(entry.newestLive) }}
          </template>
          <template v-else>not run</template>
        </td>
      </tr>
    </tbody>
  </table>
</template>
