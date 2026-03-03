/**
 * QQ Bot Channel — Rich text message builder
 * Supports Markdown messages and Embed messages for guild channels.
 */

// ---------------------------------------------------------------------------
// Markdown message (msg_type: 2)
// ---------------------------------------------------------------------------

export interface QQMarkdownMessage {
  content: string;
  keyboard?: QQKeyboard;
}

export interface QQKeyboard {
  id?: string;
  content?: {
    rows: QQKeyboardRow[];
  };
}

export interface QQKeyboardRow {
  buttons: QQKeyboardButton[];
}

export interface QQKeyboardButton {
  id: string;
  render_data: {
    label: string;
    visited_label?: string;
    style: 0 | 1; // 0 = grey, 1 = blue
  };
  action: {
    type: 0 | 1 | 2; // 0 = jump url, 1 = callback, 2 = send to bot
    permission: { type: 0 | 1 | 2; specify_role_ids?: string[]; specify_user_ids?: string[] };
    data: string;
    unsupport_tips?: string;
  };
}

/**
 * Build a Markdown message body for the QQ Bot API.
 * Markdown messages use msg_type: 2 and accept a subset of Markdown syntax.
 */
export function buildMarkdownBody(
  markdown: string,
  keyboard?: QQKeyboard,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    msg_type: 2,
    markdown: { content: markdown },
  };
  if (keyboard) {
    body.keyboard = keyboard;
  }
  return body;
}

// ---------------------------------------------------------------------------
// Embed message (msg_type: 4, guild only)
// ---------------------------------------------------------------------------

export interface QQEmbedField {
  name: string;
}

export interface QQEmbed {
  title: string;
  prompt?: string;
  thumbnail?: { url: string };
  fields?: QQEmbedField[];
}

/**
 * Build an Embed message body for guild channels.
 * Embed messages use msg_type: 4 and are only supported in guild channels.
 */
export function buildEmbedBody(embed: QQEmbed): Record<string, unknown> {
  return {
    msg_type: 4,
    embed,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert plain Markdown to QQ Markdown-compatible format.
 * QQ Markdown supports a limited subset:
 * - Bold: **text**
 * - Italic: *text*
 * - Links (guild only): [text](url)
 * - Code blocks
 * - Mentions: <@user_id>
 */
export function sanitizeMarkdown(text: string): string {
  // QQ doesn't support headings with # — convert to bold
  return text.replace(/^#{1,6}\s+(.+)$/gm, "**$1**");
}

/**
 * Create a simple inline keyboard with one row of buttons.
 */
export function createSimpleKeyboard(
  buttons: Array<{ label: string; data: string; style?: 0 | 1 }>,
): QQKeyboard {
  return {
    content: {
      rows: [
        {
          buttons: buttons.map((b, i) => ({
            id: String(i + 1),
            render_data: {
              label: b.label,
              style: b.style ?? 0,
            },
            action: {
              type: 2,
              permission: { type: 2 },
              data: b.data,
            },
          })),
        },
      ],
    },
  };
}
