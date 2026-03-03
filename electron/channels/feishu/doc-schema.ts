/**
 * JSON Schema definitions for Feishu document tools.
 * Ported from openclaw/extensions/feishu/src/doc-schema.ts (TypeBox → plain JSON Schema).
 */

export const FeishuDocSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: [
        "read",
        "write",
        "append",
        "create",
        "list_blocks",
        "get_block",
        "update_block",
        "delete_block",
      ],
      description:
        "Document action to perform",
    },
    doc_token: {
      type: "string",
      description: "Document token (extract from URL /docx/XXX)",
    },
    content: {
      type: "string",
      description:
        "Markdown content (for write: replaces entire document; for append: appends to end; for update_block: new text content)",
    },
    title: {
      type: "string",
      description: "Document title (for create action)",
    },
    folder_token: {
      type: "string",
      description: "Target folder token (for create action, optional)",
    },
    block_id: {
      type: "string",
      description: "Block ID from list_blocks (for get_block, update_block, delete_block)",
    },
  },
  required: ["action"],
};

export type FeishuDocParams = {
  action:
    | "read"
    | "write"
    | "append"
    | "create"
    | "list_blocks"
    | "get_block"
    | "update_block"
    | "delete_block";
  doc_token?: string;
  content?: string;
  title?: string;
  folder_token?: string;
  block_id?: string;
};
