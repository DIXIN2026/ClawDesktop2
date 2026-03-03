/**
 * Model Router
 * Routes agent requests to the appropriate provider and model
 * Priority: agent default -> task override -> user session switch
 */
import type { AgentModelMapping } from './types.js';

const mappings = new Map<string, AgentModelMapping>();

export function setAgentModel(mapping: AgentModelMapping): void {
  mappings.set(mapping.agentType, mapping);
}

export function getAgentModel(agentType: AgentModelMapping['agentType']): AgentModelMapping | undefined {
  return mappings.get(agentType);
}

export function getAllMappings(): AgentModelMapping[] {
  return Array.from(mappings.values());
}

export function removeAgentModel(agentType: AgentModelMapping['agentType']): boolean {
  return mappings.delete(agentType);
}

export function resolveModel(
  agentType: AgentModelMapping['agentType'],
  taskOverride?: { providerId: string; modelId: string },
  sessionOverride?: { providerId: string; modelId: string },
): { providerId: string; modelId: string } | undefined {
  // Priority 3: User session switch (highest priority)
  if (sessionOverride) return sessionOverride;

  // Priority 2: Task-specific override
  if (taskOverride) return taskOverride;

  // Priority 1: Agent default mapping
  const mapping = mappings.get(agentType);
  if (mapping) return { providerId: mapping.providerId, modelId: mapping.modelId };

  return undefined;
}
