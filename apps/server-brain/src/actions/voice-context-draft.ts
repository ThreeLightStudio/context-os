import {
  parseVoiceContextDraftInput,
  parseVoiceContextDraftOutput,
  voiceContextDraftInputSchema,
  voiceContextDraftOutputSchema,
} from "../schemas/validation.js";
import type { ActionDefinition } from "./action-registry.js";

export interface VoiceContextDraftOutput {
  summary: string;
  decisions: string[];
  insights: string[];
  next: string[];
  questions: string[];
  suggestedWork: string | null;
  topic: string | null;
  contextType: "work" | "decision" | "insight" | "plan" | "question" | "reflection" | null;
}

const systemPrompt = [
  "You are the Context OS voice-context-draft action.",
  "Turn the supplied raw voice transcript into a faithful, editable Context Draft.",
  "Do not invent facts, silently resolve uncertainty, save records, or mutate current state.",
  "Use empty arrays when a category is not present and null for low-confidence suggestions.",
  "Return only a JSON object with exactly these fields:",
  '{"summary":"string","decisions":["string"],"insights":["string"],"next":["string"],"questions":["string"],"suggestedWork":"string|null","topic":"string|null","contextType":"work|decision|insight|plan|question|reflection|null"}',
  "Do not add markdown fences or any other fields.",
].join(" ");

export const voiceContextDraftAction: ActionDefinition<
  { transcript: string },
  undefined,
  VoiceContextDraftOutput
> = {
  metadata: {
    name: "voice-context-draft",
    description: "Convert a local voice transcript into an editable structured Context Draft.",
    inputSchema: voiceContextDraftInputSchema,
    outputSchema: voiceContextDraftOutputSchema,
  },
  parseInput: parseVoiceContextDraftInput,
  parseOutput: parseVoiceContextDraftOutput,
  async execute({ input, dependencies }) {
    return dependencies.provider.generateStructured({
      systemPrompt,
      userPrompt: input.transcript,
      outputFormat: JSON.stringify(voiceContextDraftOutputSchema),
    });
  },
};
