/**
 * Channel → Agent Router
 * Bridges ChannelManager (incoming messages) to AgentExecutor (coding sessions).
 * Buffers streaming text_delta events and sends aggregated text on turn_end.
 */
import type { ChannelManager, IncomingMessage } from '../channels/manager.js';
import type { AgentExecutor, AgentExecuteOptions } from './agent-executor.js';
import type { CodingAgentEvent } from '../providers/types.js';

export interface ChannelAgentRouterDeps {
  channelManager: ChannelManager;
  executor: AgentExecutor;
  getWorkDirectory: (sessionId: string) => string;
  getAgentConfig: (sessionId: string) => Partial<AgentExecuteOptions>;
}

interface ActiveExecution {
  sessionId: string;
  textBuffer: string;
}

/**
 * Creates a channel-to-agent router.
 * Subscribes to incoming channel messages and dispatches them to the agent executor.
 * Returns a start function that returns an unsubscribe/cleanup function.
 */
export function createChannelAgentRouter(deps: ChannelAgentRouterDeps): {
  start(): () => void;
} {
  const { channelManager, executor, getWorkDirectory, getAgentConfig } = deps;
  const activeExecutions = new Map<string, ActiveExecution>();

  function handleIncomingMessage(msg: IncomingMessage): void {
    const { sessionId, content, channelId } = msg;

    if (!content.trim()) return;

    // Prevent concurrent executions for the same session
    if (activeExecutions.has(sessionId) || executor.isRunning(sessionId)) {
      channelManager.sendMessage(channelId, sessionId, '[busy] Session is currently processing a request. Please wait.').catch((err) => {
        console.error('[ChannelAgentRouter] Failed to send busy message:', err);
      });
      return;
    }

    const execution: ActiveExecution = { sessionId, textBuffer: '' };
    activeExecutions.set(sessionId, execution);

    const agentConfig = getAgentConfig(sessionId);

    const options: AgentExecuteOptions = {
      sessionId,
      prompt: content,
      workDirectory: getWorkDirectory(sessionId),
      agentType: agentConfig.agentType ?? 'coding',
      mode: agentConfig.mode ?? 'cli',
      cliBackend: agentConfig.cliBackend,
      providerId: agentConfig.providerId,
      modelId: agentConfig.modelId,
      apiKey: agentConfig.apiKey,
      baseUrl: agentConfig.baseUrl,
      apiProtocol: agentConfig.apiProtocol,
      timeoutMs: agentConfig.timeoutMs,
      noOutputTimeoutMs: agentConfig.noOutputTimeoutMs,
      onEvent: (event: CodingAgentEvent) => {
        handleAgentEvent(channelId, sessionId, execution, event);
      },
    };

    executor.execute(options).catch((err) => {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[ChannelAgentRouter] Execution error for ${sessionId}:`, errorMsg);
      sendErrorReply(channelId, sessionId, errorMsg);
    }).finally(() => {
      activeExecutions.delete(sessionId);
    });
  }

  function handleAgentEvent(
    channelId: string,
    sessionId: string,
    execution: ActiveExecution,
    event: CodingAgentEvent,
  ): void {
    switch (event.type) {
      case 'text_delta':
        // Buffer text deltas
        if (event.content) {
          execution.textBuffer += event.content;
        }
        break;

      case 'turn_end':
        // Flush accumulated text to channel
        if (execution.textBuffer.trim()) {
          channelManager.sendMessage(channelId, sessionId, execution.textBuffer).catch((err) => {
            console.error('[ChannelAgentRouter] Failed to send response:', err);
          });
          execution.textBuffer = '';
        }
        break;

      case 'error':
        if (event.errorMessage) {
          sendErrorReply(channelId, sessionId, event.errorMessage);
        }
        break;

      case 'tool_start':
        // Optionally notify the channel about tool usage
        if (event.toolName) {
          const toolInfo = `[tool] ${event.toolName}`;
          channelManager.sendMessage(channelId, sessionId, toolInfo).catch(() => {});
        }
        break;

      // tool_output, tool_end, file_changed, approval_req are internal events
      default:
        break;
    }
  }

  function sendErrorReply(channelId: string, sessionId: string, message: string): void {
    const errorText = `[error] ${message}`;
    channelManager.sendMessage(channelId, sessionId, errorText).catch((err) => {
      console.error('[ChannelAgentRouter] Failed to send error reply:', err);
    });
  }

  function start(): () => void {
    const unsubscribe = channelManager.onMessage(handleIncomingMessage);

    return () => {
      unsubscribe();
      activeExecutions.clear();
    };
  }

  return { start };
}
