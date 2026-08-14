import { describe, expect, it, vi } from "vitest";
import { LocalOpenAICompatibleProvider } from "../src/providers/local-openai-compatible.js";

describe("LocalOpenAICompatibleProvider", () => {
  it("calls the OpenAI-compatible chat completions contract and parses JSON", async () => {
    const fetchImpl = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      expect(String(input)).toBe("http://model.test/v1/chat/completions");
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
      expect(JSON.parse(String(init?.body))).toMatchObject({ model: "gemma-test", response_format: { type: "json_object" } });
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"summary":"ok","keyPoints":[]}' } }] }));
    });
    const provider = new LocalOpenAICompatibleProvider({ baseUrl: "http://model.test/v1/", model: "gemma-test", fetchImpl });

    await expect(provider.generateStructured({ systemPrompt: "system", userPrompt: "content" })).resolves.toEqual({ summary: "ok", keyPoints: [] });
    expect(provider.health()).toEqual({ status: "ok", provider: "local", model: "gemma-test" });
  });

  it("rejects non-JSON structured output", async () => {
    const provider = new LocalOpenAICompatibleProvider({
      baseUrl: "http://model.test/v1",
      model: "test",
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "not json" } }] }))),
    });

    await expect(provider.generateStructured({ systemPrompt: "system", userPrompt: "content" })).rejects.toMatchObject({ code: "provider_invalid_output" });
  });
});
