import { ActionRegistry } from "./action-registry.js";
import { dailySummaryAction } from "./daily-summary.js";
import { summarizeAction } from "./summarize.js";

export function createDefaultActionRegistry(): ActionRegistry {
  return new ActionRegistry().register(summarizeAction).register(dailySummaryAction);
}

export { ActionRegistry, UnknownActionError } from "./action-registry.js";
export type { ActionDefinition, ActionExecutionInput } from "./action-registry.js";
export { dailySummaryAction } from "./daily-summary.js";
export type { DailySummaryOutput } from "./daily-summary.js";
export { summarizeAction } from "./summarize.js";
