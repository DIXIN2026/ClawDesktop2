/**
 * Agent Message Bus
 * Inter-agent communication layer supporting pub/sub, direct messaging, and broadcasts.
 */

export type AgentType = 'coding' | 'requirements' | 'design' | 'testing' | 'orchestrator';

export interface AgentMessage {
  id: string;
  from: AgentId;
  to: AgentId | 'broadcast';
  type: MessageType;
  payload: unknown;
  timestamp: number;
  replyTo?: string;
}

export type AgentId = `${AgentType}:${string}`;

export type MessageType =
  | 'task_request'
  | 'task_result'
  | 'task_status'
  | 'clarification_request'
  | 'clarification_response'
  | 'error'
  | 'progress'
  | 'handoff';

export interface AgentRegistration {
  id: AgentId;
  type: AgentType;
  capabilities: string[];
  status: 'idle' | 'busy' | 'error';
  sessionId?: string;
}

type MessageHandler = (message: AgentMessage) => void | Promise<void>;
type Subscription = { agentId: AgentId; handler: MessageHandler };

export class MessageBus {
  private agents = new Map<AgentId, AgentRegistration>();
  private mailboxes = new Map<AgentId, AgentMessage[]>();
  private subscriptions: Subscription[] = [];
  private readonly maxMailboxSize: number;

  constructor(maxMailboxSize = 100) {
    this.maxMailboxSize = maxMailboxSize;
  }

  register(agent: AgentRegistration): void {
    this.agents.set(agent.id, agent);
    if (!this.mailboxes.has(agent.id)) {
      this.mailboxes.set(agent.id, []);
    }
  }

  unregister(agentId: AgentId): void {
    this.agents.delete(agentId);
    this.mailboxes.delete(agentId);
    this.subscriptions = this.subscriptions.filter((s) => s.agentId !== agentId);
  }

  updateStatus(agentId: AgentId, status: AgentRegistration['status']): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.status = status;
    }
  }

  getAgent(agentId: AgentId): AgentRegistration | undefined {
    return this.agents.get(agentId);
  }

  getAgentsByType(type: AgentType): AgentRegistration[] {
    return Array.from(this.agents.values()).filter((a) => a.type === type);
  }

  getAvailableAgents(type?: AgentType): AgentRegistration[] {
    return Array.from(this.agents.values()).filter(
      (a) => a.status === 'idle' && (!type || a.type === type),
    );
  }

  send(message: Omit<AgentMessage, 'id' | 'timestamp'>): string {
    const fullMessage: AgentMessage = {
      ...message,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      timestamp: Date.now(),
    };

    if (message.to === 'broadcast') {
      this.broadcast(fullMessage);
    } else {
      this.deliver(message.to, fullMessage);
    }

    return fullMessage.id;
  }

  reply(originalMessage: AgentMessage, payload: unknown): string {
    return this.send({
      from: originalMessage.to as AgentId,
      to: originalMessage.from,
      type: 'task_result',
      payload,
      replyTo: originalMessage.id,
    });
  }

  private deliver(agentId: AgentId, message: AgentMessage): void {
    const mailbox = this.mailboxes.get(agentId);
    if (!mailbox) {
      console.warn(`[MessageBus] No mailbox for agent ${agentId}`);
      return;
    }

    mailbox.push(message);
    if (mailbox.length > this.maxMailboxSize) {
      mailbox.shift();
    }

    this.subscriptions
      .filter((s) => s.agentId === agentId)
      .forEach((s) => {
        try {
          s.handler(message);
        } catch (err) {
          console.error(
            `[MessageBus] Handler error for ${agentId}:`,
            err instanceof Error ? err.message : String(err),
          );
        }
      });
  }

  private broadcast(message: AgentMessage): void {
    for (const agentId of this.agents.keys()) {
      if (agentId !== message.from) {
        const mailbox = this.mailboxes.get(agentId);
        if (mailbox) {
          mailbox.push({ ...message, to: agentId });
          if (mailbox.length > this.maxMailboxSize) {
            mailbox.shift();
          }
        }
      }
    }

    this.subscriptions
      .filter((s) => s.agentId !== message.from)
      .forEach((s) => {
        try {
          s.handler({ ...message, to: s.agentId });
        } catch (err) {
          console.error(
            `[MessageBus] Broadcast handler error:`,
            err instanceof Error ? err.message : String(err),
          );
        }
      });
  }

  receive(agentId: AgentId): AgentMessage[] {
    const mailbox = this.mailboxes.get(agentId);
    if (!mailbox) return [];
    const messages = [...mailbox];
    mailbox.length = 0;
    return messages;
  }

  peek(agentId: AgentId): AgentMessage[] {
    return this.mailboxes.get(agentId) ?? [];
  }

  subscribe(agentId: AgentId, handler: MessageHandler): () => void {
    const subscription: Subscription = { agentId, handler };
    this.subscriptions.push(subscription);
    return () => {
      const idx = this.subscriptions.indexOf(subscription);
      if (idx >= 0) this.subscriptions.splice(idx, 1);
    };
  }

  clear(): void {
    this.agents.clear();
    this.mailboxes.clear();
    this.subscriptions = [];
  }
}

let instance: MessageBus | null = null;

export function getMessageBus(): MessageBus {
  if (!instance) {
    instance = new MessageBus();
  }
  return instance;
}

export function createAgentId(type: AgentType, sessionId: string): AgentId {
  return `${type}:${sessionId}`;
}
