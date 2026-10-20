<script setup lang="ts">
// The home page's product picture: a terminal window with the first run. The text is real output of
// `init --fast anthropic/claude-haiku-4-5` and of the curl it prints. The key is cut and the answer keeps only the fields that matter.
declare const __PLUGBOARD_LATEST__: string
const version = __PLUGBOARD_LATEST__
</script>

<template>
  <figure class="term" aria-label="A terminal: install plugboard, then call it with curl">
    <div class="bar" aria-hidden="true">
      <i class="dot r" /><i class="dot y" /><i class="dot g" />
      <span class="name">zsh</span>
    </div>
    <div class="scroll">
      <pre><code><span class="prompt">$</span> <span class="cmd">bunx opencode-plugboard init --fast anthropic/claude-haiku-4-5</span>
<span class="out">Added opencode-plugboard@{{ version }} in ~/.config/opencode/opencode.jsonc.</span>
<span class="out">App key for `my-app` (shown once; it is also in the file):</span>
  <span class="key">pb_u3oW-g8E3gZ-aA3mduNUm</span><span class="dim">…</span>

<span class="prompt">$</span> <span class="cmd">curl -s http://127.0.0.1:4010/v1/chat/completions \</span>
<span class="cmd">    -H "Authorization: Bearer $PLUGBOARD_KEY" \</span>
<span class="cmd">    -H "Content-Type: application/json" \</span>
<span class="cmd">    -d '{"model": "fast", "messages": [{"role": "user", "content": "reply with exactly: pong"}]}'</span>
<span class="brace">{</span>
  <span class="jk">"model"</span>: <span class="js">"anthropic/claude-haiku-4-5"</span>,
  <span class="jk">"choices"</span>: [{ <span class="jk">"message"</span>: { <span class="jk">"role"</span>: <span class="js">"assistant"</span>, <span class="jk">"content"</span>: <span class="js">"pong"</span> } }],
  <span class="jk">"usage"</span>: { <span class="jk">"prompt_tokens"</span>: <span class="jn">13</span>, <span class="jk">"completion_tokens"</span>: <span class="jn">5</span> }
<span class="brace">}</span></code></pre>
    </div>
  </figure>
</template>

<style scoped>
/* A terminal is dark in both themes, like any app window on a page. */
.term {
  --t-bg: #17171a;
  --t-bar: #202024;
  --t-text: #e4e4e7;
  --t-dim: #71717a;
  --t-accent: #aeb1ff;
  --t-green: #86d9a0;
  --t-amber: #e9c46a;

  margin: 0 auto;
  width: 100%;
  max-width: 880px;
  overflow: hidden;
  border-radius: 12px;
  background: var(--t-bg);
  box-shadow:
    0 0 0 1px rgb(0 0 0 / 0.12),
    0 2px 6px rgb(0 0 0 / 0.08),
    0 36px 70px -24px rgb(24 24 40 / 0.45);
  text-align: left;
}

.dark .term {
  box-shadow:
    0 0 0 1px rgb(255 255 255 / 0.1),
    0 36px 70px -24px rgb(0 0 0 / 0.7);
}

.bar {
  position: relative;
  display: flex;
  align-items: center;
  gap: 7px;
  height: 38px;
  padding: 0 14px;
  background: var(--t-bar);
}

.dot {
  width: 11px;
  height: 11px;
  border-radius: 50%;
}

.r {
  background: #ff5f57;
}

.y {
  background: #febc2e;
}

.g {
  background: #28c840;
}

.name {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--t-dim);
  font: 12px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  pointer-events: none;
}

.scroll {
  overflow-x: auto;
  padding: 18px 22px 22px;
}

pre {
  margin: 0;
  width: max-content;
  min-width: 100%;
  color: var(--t-text);
  font: 13px/1.7 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  tab-size: 2;
}

code {
  font: inherit;
  color: inherit;
}

.prompt {
  color: var(--t-accent);
}

.cmd {
  color: #fafafa;
}

.out,
.dim {
  color: var(--t-dim);
}

.key,
.js {
  color: var(--t-green);
}

.jk {
  color: var(--t-accent);
}

.jn {
  color: var(--t-amber);
}

@media (max-width: 640px) {
  .bar {
    height: 32px;
    padding: 0 12px;
  }

  .scroll {
    padding: 14px 16px 18px;
  }

  /* On a phone long lines wrap instead of scrolling. */
  pre {
    width: auto;
    font-size: 11px;
    line-height: 1.65;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
}
</style>
