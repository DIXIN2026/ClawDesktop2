/**
 * Agent ↔ Board Integration
 * Automatically creates board issues from agent outputs.
 * - Requirements agent → task/story cards
 * - Testing agent → bug cards
 */
import { randomUUID } from 'crypto';
import {
  createBoardIssue,
  getBoardStates,
} from '../utils/db.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ParsedTask {
  title: string;
  description: string;
  priority: 'urgent' | 'high' | 'medium' | 'low' | 'none';
  issueType: 'task' | 'story' | 'bug' | 'epic';
}

// ---------------------------------------------------------------------------
// Parse tasks from requirements agent PRD output
// ---------------------------------------------------------------------------

/**
 * Extract task items from a PRD or requirements analysis output.
 * Looks for numbered/bulleted lists with priority markers (P0/P1/P2).
 */
export function parseTasksFromPRD(prdContent: string): ParsedTask[] {
  const tasks: ParsedTask[] = [];
  const lines = prdContent.split('\n');

  // Pattern: lines starting with "- " or numbered items containing P0/P1/P2
  const taskLineRegex = /^[-*]\s+(?:\[?([P0-3]|优先级[：:]?\s*(?:高|中|低|紧急))\]?\s*)?(.+)/;
  const numberedRegex = /^\d+\.\s+(?:\[?([P0-3]|优先级[：:]?\s*(?:高|中|低|紧急))\]?\s*)?(.+)/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const match = taskLineRegex.exec(line) ?? numberedRegex.exec(line);
    if (!match) continue;

    const priorityStr = match[1]?.trim() ?? '';
    const title = match[2].trim();

    // Skip empty or very short titles
    if (title.length < 3) continue;
    // Skip obvious non-task lines
    if (title.startsWith('#') || title.startsWith('```')) continue;

    const priority = mapPriority(priorityStr);
    const issueType = detectIssueType(title);

    // Look ahead for description (indented text after the task line)
    let description = '';
    for (let j = i + 1; j < lines.length; j++) {
      const nextLine = lines[j];
      if (nextLine.match(/^\s{2,}/) && !nextLine.trim().startsWith('-') && !nextLine.trim().startsWith('*')) {
        description += nextLine.trim() + '\n';
      } else {
        break;
      }
    }

    tasks.push({
      title: title.slice(0, 200),
      description: description.trim(),
      priority,
      issueType,
    });
  }

  return tasks;
}

// ---------------------------------------------------------------------------
// Parse bugs from testing agent output
// ---------------------------------------------------------------------------

/**
 * Extract bug findings from a testing agent security/quality report.
 */
export function parseBugsFromTestReport(reportContent: string): ParsedTask[] {
  const bugs: ParsedTask[] = [];

  // Look for severity markers: [critical], [high], [medium], [low]
  const findingRegex = /\[(\w+)\]\s*(.+?)(?:\n|$)/g;
  let match: RegExpExecArray | null;

  while ((match = findingRegex.exec(reportContent)) !== null) {
    const severity = match[1].toLowerCase();
    const message = match[2].trim();

    if (severity === 'critical' || severity === 'high' || severity === 'medium' || severity === 'low') {
      bugs.push({
        title: message.slice(0, 200),
        description: `Severity: ${severity}\nSource: Automated test report`,
        priority: severity === 'critical' ? 'urgent' : severity as ParsedTask['priority'],
        issueType: 'bug',
      });
    }
  }

  return bugs;
}

// ---------------------------------------------------------------------------
// Create board issues from parsed tasks
// ---------------------------------------------------------------------------

/**
 * Batch-create board issues from parsed task list.
 * Returns the number of issues created.
 */
export function createBoardIssuesFromTasks(tasks: ParsedTask[]): number {
  const states = getBoardStates();
  // Find the "Todo" or first "unstarted" state
  const todoState = states.find(s => s.category === 'unstarted')
    ?? states.find(s => s.category === 'backlog')
    ?? states[0];

  if (!todoState) return 0;

  let created = 0;
  for (const task of tasks) {
    try {
      createBoardIssue({
        id: randomUUID(),
        title: task.title,
        description: task.description || undefined,
        stateId: todoState.id,
        priority: task.priority,
        issueType: task.issueType,
      });
      created++;
    } catch (err) {
      console.error('[BoardIntegration] Failed to create issue:', err);
    }
  }

  return created;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapPriority(raw: string): ParsedTask['priority'] {
  const lower = raw.toLowerCase();
  if (lower === 'p0' || lower.includes('紧急')) return 'urgent';
  if (lower === 'p1' || lower.includes('高')) return 'high';
  if (lower === 'p2' || lower.includes('中')) return 'medium';
  if (lower === 'p3' || lower.includes('低')) return 'low';
  return 'medium';
}

function detectIssueType(title: string): ParsedTask['issueType'] {
  const lower = title.toLowerCase();
  if (lower.includes('bug') || lower.includes('修复') || lower.includes('缺陷')) return 'bug';
  if (lower.includes('用户故事') || lower.includes('story') || lower.includes('作为')) return 'story';
  if (lower.includes('epic') || lower.includes('史诗')) return 'epic';
  return 'task';
}
