import { ModelProviderError, type GenerateRequest, type ModelProvider, type ProviderHealth } from "./model-provider.js";

export interface LocalOpenAICompatibleOptions {
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: unknown } }>;
};

function trimBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function completionContent(value: unknown): string {
  if (typeof value !== "object" || value === null || !Array.isArray((value as ChatCompletionResponse).choices)) {
    throw new ModelProviderError("local model returned an invalid chat completion");
  }
  const content = (value as ChatCompletionResponse).choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim() === "") {
    throw new ModelProviderError("local model returned empty content");
  }
  return content;
}

export class LocalOpenAICompatibleProvider implements ModelProvider {
  readonly id = "local";
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: LocalOpenAICompatibleOptions) {
    this.baseUrl = trimBaseUrl(options.baseUrl);
    this.model = options.model;
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async generate(request: GenerateRequest): Promise<string> {
    const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: request.systemPrompt },
          { role: "user", content: request.userPrompt },
        ],
        temperature: 0.2,
        ...(request.outputFormat ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    }).catch((cause) => {
      throw new ModelProviderError(`could not reach local model: ${cause instanceof Error ? cause.message : "request failed"}`, "provider_unreachable");
    });

    if (!response.ok) {
      throw new ModelProviderError(`local model request failed (${response.status})`, "provider_http");
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ModelProviderError("local model returned invalid JSON", "provider_malformed");
    }
    return completionContent(body);
  }

  async generateStructured(request: GenerateRequest): Promise<unknown> {
    const content = await this.generate({
      ...request,
      outputFormat: request.outputFormat ?? "json_object",
    });
    try {
      return JSON.parse(content);
    } catch {
      throw new ModelProviderError("local model returned non-JSON structured output", "provider_invalid_output");
    }
  }

  health(): ProviderHealth {
    return { status: "ok", provider: this.id, model: this.model };
  }
}
