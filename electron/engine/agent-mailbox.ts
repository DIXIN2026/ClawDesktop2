/**
 * Agent Mailbox
 * Per-agent message queue with priority support and filtering.
 */

import {
  getMessageBus,
  type AgentId,
  type AgentMessage,
  type MessageType,
} from './message-bus.js';

export interface MailboxOptions {
  agentId: AgentId;
  filterTypes?: MessageType[];
  onMessage?: (message: AgentMessage) => void | Promise<void>;
}

export interface PrioritizedMessage {
  message: AgentMessage;
  priority: number;
}

const PRIORITY_MAP: Record<MessageType, number> = {
  error: 100,
  task_request: 80,
  clarification_request: 70,
  clarification_response: 60,
  handoff: 50,
  task_status: 40,
  progress: 20,
  task_result: 10,
};

export class AgentMailbox {
  private readonly agentId: AgentId;
  private readonly filterTypes: Set<MessageType> | null;
  private readonly onMessage?: (message: AgentMessage) => void | Promise<void>;
  private unsubscribe?: () => void;
  private pending: PrioritizedMessage[] = [];
  private processing = false;

  constructor(options: MailboxOptions) {
    this.agentId = options.agentId;
    this.filterTypes = options.filterTypes ? new Set(options.filterTypes) : null;
    this.onMessage = options.onMessage;
  }

  start(): void {
    const bus = getMessageBus();
    this.unsubscribe = bus.subscribe(this.agentId, async (message) => {
      if (this.filterTypes && !this.filterTypes.has(message.type)) {
        return;
      }

      const priority = PRIORITY_MAP[message.type] ?? 50;
      this.pending.push({ message, priority });
      this.pending.sort((a, b) => b.priority - a.priority);

      if (this.onMessage && !this.processing) {
        this.processNext();
      }
    });
  }

  stop(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = undefined;
    }
  }

  private async processNext(): Promise<void> {
    if (this.processing || this.pending.length === 0) return;

    this.processing = true;
    const item = this.pending.shift();

    try {
      if (item && this.onMessage) {
        await this.onMessage(item.message);
      }
    } catch (err) {
      console.error(
        `[AgentMailbox] Error processing message for ${this.agentId}:`,
        err instanceof Error ? err.message : String(err),
      );
    }

    this.processing = false;

    if (this.pending.length > 0) {
      setImmediate(() => this.processNext());
    }
  }

  getPending(): AgentMessage[] {
    return this.pending.map((p) => p.message);
  }

  getPendingCount(): number {
    return this.pending.length;
  }

  clear(): void {
    this.pending = [];
  }

  send<T>(to: AgentId | 'broadcast', type: MessageType, payload: T): string {
    const bus = getMessageBus();
    return bus.send({
      from: this.agentId,
      to,
      type,
      payload,
    });
  }

  reply<T>(originalMessage: AgentMessage, payload: T): string {
    const bus = getMessageBus();
    return bus.reply(originalMessage, payload);
  }
}

export function createMailbox(options: MailboxOptions): AgentMailbox {
  const mailbox = new AgentMailbox(options);
  mailbox.start();
  return mailbox;
}