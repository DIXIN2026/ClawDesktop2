/**
 * JSON Schema definitions for Feishu wiki (knowledge base) tools.
 * Ported from openclaw/extensions/feishu/src/wiki-schema.ts (TypeBox → plain JSON Schema).
 */

export const FeishuWikiSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["spaces", "nodes", "get", "search", "create", "move", "rename"],
      description: "Wiki action to perform",
    },
    space_id: {
      type: "string",
      description: "Knowledge space ID",
    },
    parent_node_token: {
      type: "string",
      description: "Parent node token (optional, omit for root)",
    },
    token: {
      type: "string",
      description: "Wiki node token (from URL /wiki/XXX) — for get action",
    },
    query: {
      type: "string",
      description: "Search query — for search action",
    },
    title: {
      type: "string",
      description: "Node title — for create and rename actions",
    },
    obj_type: {
      type: "string",
      enum: ["docx", "sheet", "bitable"],
      description: "Object type for create (default: docx)",
    },
    node_token: {
      type: "string",
      description: "Node token — for move and rename actions",
    },
    target_space_id: {
      type: "string",
      description: "Target space ID for move (optional, same space if omitted)",
    },
    target_parent_token: {
      type: "string",
      description: "Target parent node token for move (optional, root if omitted)",
    },
  },
  required: ["action"],
};

export type FeishuWikiParams = {
  action: "spaces" | "nodes" | "get" | "search" | "create" | "move" | "rename";
  space_id?: string;
  parent_node_token?: string;
  token?: string;
  query?: string;
  title?: string;
  obj_type?: "docx" | "sheet" | "bitable";
  node_token?: string;
  target_space_id?: string;
  target_parent_token?: string;
};
