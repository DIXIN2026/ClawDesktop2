/**
 * Message Queue
 * Manages concurrent container execution with limits and retry.
 *
 * Also exports EventBus for streaming Agent events to the UI layer.
 */

import type { CodingAgentEvent } from '../providers/types.js';

interface QueueItem<T> {
  id: string;
  execute: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  retryCount: number;
  maxRetries: number;
}

const MAX_CONCURRENT_CONTAINERS = 4;
const DEFAULT_MAX_RETRIES = 2;
const BASE_BACKOFF_MS = 1000;

export class MessageQueue {
  private queue: QueueItem<unknown>[] = [];
  private activeCount = 0;
  private readonly maxConcurrent: number;

  constructor(maxConcurrent = MAX_CONCURRENT_CONTAINERS) {
    this.maxConcurrent = maxConcurrent;
  }

  enqueue<T>(id: string, execute: () => Promise<T>, maxRetries = DEFAULT_MAX_RETRIES): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        id,
        execute: execute as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
        retryCount: 0,
        maxRetries,
      });
      this.processNext();
    });
  }

  private async processNext(): Promise<void> {
    if (this.activeCount >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }

    const item = this.queue.shift();
    if (!item) return;

    this.activeCount++;

    try {
      const result = await item.execute();
      item.resolve(result);
    } catch (err) {
      if (item.retryCount < item.maxRetries) {
        item.retryCount++;
        const backoff = BASE_BACKOFF_MS * Math.pow(2, item.retryCount - 1);
        setTimeout(() => {
          this.queue.unshift(item);
          this.processNext();
        }, backoff);
        this.activeCount--;
        return;
      }
      item.reject(err);
    }

    this.activeCount--;
    this.processNext();
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  get runningCount(): number {
    return this.activeCount;
  }

  clear(): void {
    for (const item of this.queue) {
      item.reject(new Error('Queue cleared'));
    }
    this.queue = [];
  }
}

// ---------------------------------------------------------------------------
// EventBus — streaming Agent events to the UI
// ---------------------------------------------------------------------------

type EventCallback = (event: CodingAgentEvent) => void;

export class EventBus {
  private subscribers = new Map<string, Set<EventCallback>>();
  private buffers = new Map<string, CodingAgentEvent[]>();
  private readonly maxBufferSize: number;

  constructor(maxBufferSize = 1000) {
    this.maxBufferSize = maxBufferSize;
  }

  /**
   * Subscribe to events for a specific session.
   * Returns an unsubscribe function.
   */
  subscribe(sessionId: string, callback: EventCallback): () => void {
    let subs = this.subscribers.get(sessionId);
    if (!subs) {
      subs = new Set();
      this.subscribers.set(sessionId, subs);
    }
    subs.add(callback);

    return () => {
      subs.delete(callback);
      if (subs.size === 0) {
        this.subscribers.delete(sessionId);
      }
    };
  }

  /**
   * Emit an event for a session. Notifies all subscribers and buffers the event.
   */
  emit(sessionId: string, event: CodingAgentEvent): void {
    // Buffer the event
    let buffer = this.buffers.get(sessionId);
    if (!buffer) {
      buffer = [];
      this.buffers.set(sessionId, buffer);
    }
    buffer.push(event);

    // Evict oldest when buffer exceeds limit
    if (buffer.length > this.maxBufferSize) {
      buffer.splice(0, buffer.length - this.maxBufferSize);
    }

    // Notify subscribers (wrapped in try-catch to prevent one failing subscriber
    // from blocking others)
    const subs = this.subscribers.get(sessionId);
    if (subs) {
      for (const cb of subs) {
        try {
          cb(event);
        } catch (err) {
          console.error(
            `[EventBus] Subscriber error for session ${sessionId}:`,
            err instanceof Error ? err.message : String(err),
          );
        }
      }
    }
  }

  /**
   * Return the buffered events for a session (e.g. for late-joining UI).
   */
  getBuffer(sessionId: string): CodingAgentEvent[] {
    return this.buffers.get(sessionId) ?? [];
  }

  /**
   * Clear the event buffer for a session.
   */
  clearBuffer(sessionId: string): void {
    this.buffers.delete(sessionId);
  }

  /**
   * Clear all subscribers and buffers.
   */
  clearAll(): void {
    this.subscribers.clear();
    this.buffers.clear();
  }
}
