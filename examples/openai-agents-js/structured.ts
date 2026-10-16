// S6, structured output through the OpenAI Agents SDK: the agent's outputType is a zod schema, sent as a json_schema text format.
import { Agent, run } from "@openai/agents"
import type OpenAI from "openai"
import { z } from "zod"
import { modelFor } from "./chat.ts"

export async function runStructured(client: OpenAI, model: string) {
  // #region snippet
  const Meal = z.object({ calories: z.number(), protein_g: z.number() })
  const agent = new Agent({ name: "meal", model: modelFor(client, model), instructions: "Estimate the meal.", outputType: Meal })
  const result = await run(agent, "Estimate: 2 boiled eggs and a slice of toast.")
  // #endregion snippet
  const data = result.finalOutput as Record<string, unknown>
  return {
    calories: data.calories ?? null,
    protein_g: data.protein_g ?? null,
    extra_keys: Object.keys(data).filter((key) => key !== "calories" && key !== "protein_g").sort(),
  }
}
