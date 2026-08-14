import { parseSummarizeInput, parseSummarizeOutput, summarizeInputSchema, summarizeOutputSchema } from "../schemas/validation.js";
import type { ActionDefinition } from "./action-registry.js";

const systemPrompt = [
  "You are the Context OS summarization action.",
  "Summarize the user's content faithfully and concisely.",
  "Return only a JSON object with exactly these fields:",
  '{"summary":"string","keyPoints":["string"]}',
  "Do not add markdown fences or any other fields.",
].join(" ");

export const summarizeAction: ActionDefinition<{ content: string }, undefined, { summary: string; keyPoints: string[] }> = {
  metadata: {
    name: "summarize",
    description: "Summarize supplied content into a short summary and key points.",
    inputSchema: summarizeInputSchema,
    outputSchema: summarizeOutputSchema,
  },
  parseInput: parseSummarizeInput,
  parseOutput: parseSummarizeOutput,
  async execute({ input, dependencies }) {
    return dependencies.provider.generateStructured({
      systemPrompt,
      userPrompt: input.content,
      outputFormat: JSON.stringify(summarizeOutputSchema),
    });
  },
};
