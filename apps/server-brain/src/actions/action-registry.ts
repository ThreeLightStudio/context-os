import { BrainValidationError } from "../schemas/validation.js";
import type { ActionExecutionDependencies, ActionMetadata } from "../types.js";

export interface ActionExecutionInput<TInput, TContext> {
  input: TInput;
  context: TContext | undefined;
  dependencies: ActionExecutionDependencies;
}

export interface ActionDefinition<TInput = unknown, TContext = unknown, TOutput = unknown> {
  metadata: ActionMetadata;
  parseInput(value: unknown): TInput;
  parseOutput(value: unknown): TOutput;
  resolveContext?: (input: TInput, dependencies: ActionExecutionDependencies) => Promise<TContext>;
  execute(input: ActionExecutionInput<TInput, TContext>): Promise<unknown>;
}

export class UnknownActionError extends Error {
  constructor(public readonly action: string) {
    super(`unknown action: ${action}`);
    this.name = "UnknownActionError";
  }
}

export class ActionRegistry {
  private readonly definitions = new Map<string, ActionDefinition>();

  register<TInput, TContext, TOutput>(definition: ActionDefinition<TInput, TContext, TOutput>): this {
    const name = definition.metadata.name.trim();
    if (!name) throw new BrainValidationError("action name must not be empty");
    if (this.definitions.has(name)) throw new BrainValidationError(`action is already registered: ${name}`);
    this.definitions.set(name, definition as ActionDefinition);
    return this;
  }

  get(name: string): ActionDefinition {
    const definition = this.definitions.get(name);
    if (!definition) throw new UnknownActionError(name);
    return definition;
  }

  list(): ActionMetadata[] {
    return [...this.definitions.values()].map(({ metadata }) => metadata);
  }
}
