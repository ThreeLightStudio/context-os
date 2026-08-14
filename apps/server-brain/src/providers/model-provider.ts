export interface GenerateRequest {
  systemPrompt: string;
  userPrompt: string;
  outputFormat?: string;
}

export interface ProviderHealth {
  status: "ok";
  provider: string;
  model: string;
}

export interface ModelProvider {
  readonly id: string;
  generate(request: GenerateRequest): Promise<string>;
  generateStructured(request: GenerateRequest): Promise<unknown>;
  health(): ProviderHealth;
}

export class ModelProviderError extends Error {
  constructor(message: string, public readonly code = "provider_error") {
    super(message);
    this.name = "ModelProviderError";
  }
}
