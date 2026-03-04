import { describe, it, expect } from 'vitest';
import { MessageBus, type AgentId } from '../message-bus.js';

describe('MessageBus', () => {
  it('preserves mailbox when re-registering same agent id', () => {
    const bus = new MessageBus();
    const agentId = 'coding:test-session' as AgentId;
    const fromId = 'orchestrator:test-pipeline' as AgentId;

    bus.register({
      id: agentId,
      type: 'coding',
      capabilities: [],
      status: 'idle',
    });

    bus.send({
      from: fromId,
      to: agentId,
      type: 'handoff',
      payload: { foo: 'bar' },
    });
    expect(bus.peek(agentId).length).toBe(1);

    bus.register({
      id: agentId,
      type: 'coding',
      capabilities: ['task-execution'],
      status: 'busy',
    });

    expect(bus.peek(agentId).length).toBe(1);
  });
});
