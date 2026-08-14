import { BrainValidationError } from "../schemas/validation.js";
import { ModelProviderError } from "../providers/model-provider.js";
import { ServerContextClientError } from "../context/server-context-client.js";
import type { ActionExecutionDependencies, BrainTask } from "../types.js";
import { ActionRegistry } from "../actions/action-registry.js";

export type TaskRunErrorCode = "validation" | "provider" | "context" | "execution";

export class TaskRunError extends Error {
  constructor(
    message: string,
    public readonly code: TaskRunErrorCode,
    public readonly task: BrainTask,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "TaskRunError";
  }
}

export class TaskNotFoundError extends Error {
  constructor(id: string) {
    super(`task not found: ${id}`);
    this.name = "TaskNotFoundError";
  }
}

function copyTask(task: BrainTask): BrainTask {
  return {
    ...task,
    ...(task.error ? { error: { ...task.error } } : {}),
  };
}

export class InMemoryTaskStore {
  private readonly tasks = new Map<string, BrainTask>();

  create(action: string, input: unknown): BrainTask {
    const task: BrainTask = {
      id: crypto.randomUUID(),
      action,
      status: "pending",
      input,
      createdAt: new Date().toISOString(),
    };
    this.tasks.set(task.id, task);
    return copyTask(task);
  }

  get(id: string): BrainTask {
    const task = this.tasks.get(id);
    if (!task) throw new TaskNotFoundError(id);
    return copyTask(task);
  }

  markRunning(id: string): BrainTask {
    const task = this.getMutable(id);
    if (task.status !== "pending") throw new Error(`task ${id} cannot start from ${task.status}`);
    task.status = "running";
    task.startedAt = new Date().toISOString();
    return copyTask(task);
  }

  complete(id: string, result: unknown): BrainTask {
    const task = this.getMutable(id);
    if (task.status !== "running") throw new Error(`task ${id} cannot complete from ${task.status}`);
    task.status = "completed";
    task.completedAt = new Date().toISOString();
    task.result = result;
    return copyTask(task);
  }

  fail(id: string, code: string, message: string): BrainTask {
    const task = this.getMutable(id);
    if (task.status !== "running" && task.status !== "pending") throw new Error(`task ${id} cannot fail from ${task.status}`);
    task.status = "failed";
    task.completedAt = new Date().toISOString();
    task.error = { code, message };
    return copyTask(task);
  }

  private getMutable(id: string): BrainTask {
    const task = this.tasks.get(id);
    if (!task) throw new TaskNotFoundError(id);
    return task;
  }
}

export interface TaskRunnerOptions {
  registry: ActionRegistry;
  dependencies: ActionExecutionDependencies;
  store?: InMemoryTaskStore;
}

export class TaskRunner {
  readonly store: InMemoryTaskStore;
  private readonly registry: ActionRegistry;
  private readonly dependencies: ActionExecutionDependencies;

  constructor(options: TaskRunnerOptions) {
    this.registry = options.registry;
    this.dependencies = options.dependencies;
    this.store = options.store ?? new InMemoryTaskStore();
  }

  async run(actionName: string, rawInput: unknown, providedContext?: unknown): Promise<{ task: BrainTask; result: unknown }> {
    const definition = this.registry.get(actionName);
    const task = this.store.create(actionName, rawInput);
    this.store.markRunning(task.id);

    try {
      const input = definition.parseInput(rawInput);
      const context = providedContext !== undefined
        ? providedContext
        : definition.resolveContext
          ? await definition.resolveContext(input, this.dependencies)
          : undefined;
      const rawResult = await definition.execute({ input, context, dependencies: this.dependencies });
      const result = definition.parseOutput(rawResult);
      const completed = this.store.complete(task.id, result);
      return { task: completed, result };
    } catch (cause) {
      const code = cause instanceof BrainValidationError
        ? "validation"
        : cause instanceof ModelProviderError
          ? "provider"
          : cause instanceof ServerContextClientError
            ? "context"
            : "execution";
      const message = cause instanceof Error ? cause.message : "task execution failed";
      const failed = this.store.fail(task.id, code, message);
      throw new TaskRunError(message, code, failed, cause);
    }
  }
}
