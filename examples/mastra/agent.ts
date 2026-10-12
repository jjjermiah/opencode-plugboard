// Mastra agent on plugboard: text, stream, and a tool round trip.
// Setup: npm i @mastra/core zod   Run: PLUGBOARD_KEY=<app key> bun agent.ts
// PLUGBOARD_URL is the base with /v1 (default http://127.0.0.1:4010/v1).
// PLUGBOARD_MODEL_ID defaults to "plugboard/fast": the prefix routes through Mastra's
// custom OpenAI-compatible provider; a bare "fast" fails to resolve in Mastra 1.76.
import { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

const URL = process.env.PLUGBOARD_URL ?? "http://127.0.0.1:4010/v1";
const KEY = process.env.PLUGBOARD_KEY ?? "";
const MODEL = process.env.PLUGBOARD_MODEL_ID ?? "plugboard/fast";

const weather = createTool({
  id: "get_weather",
  description: "Current weather for a city.",
  inputSchema: z.object({ city: z.string() }),
  outputSchema: z.object({ temp_c: z.number(), sky: z.string() }),
  execute: async () => ({ temp_c: 18, sky: "cloudy" }),
});

const agent = new Agent({
  id: "plugboard-agent",
  name: "Plugboard",
  instructions: "Be concise.",
  model: { id: MODEL, url: URL, apiKey: KEY },
  tools: { get_weather: weather },
});

const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${name}: ${ok ? "pass" : "fail"} ${detail}`.trimEnd());
  return ok;
};

const results: boolean[] = [];
try {
  const text = await agent.generate("Reply with exactly: pong");
  results.push(check("text", text.text.toLowerCase().includes("pong"), JSON.stringify(text.text.slice(0, 40))));

  const s = await agent.stream("Reply with exactly: pong");
  let streamed = "";
  let parts = 0;
  for await (const chunk of s.textStream) {
    streamed += chunk;
    parts++;
  }
  results.push(check("stream", parts > 0 && streamed.toLowerCase().includes("pong"), `${parts} chunks`));

  const tool = await agent.generate("What is the weather in Paris? Use the tool.");
  const called = (tool.toolCalls ?? []).some((c: any) => (c.payload?.toolName ?? c.toolName) === "get_weather");
  results.push(check("tool call", called, `${(tool.toolCalls ?? []).length} call(s)`));
  results.push(check("tool round trip", /18|cloud/i.test(tool.text), JSON.stringify(tool.text.slice(0, 60))));
} catch (err) {
  console.log("error:", (err as Error).message.slice(0, 300));
  results.push(false);
}
process.exit(results.every(Boolean) ? 0 : 1);
