/**
 * JSON Schema definitions for Feishu permission management tools.
 * Ported from openclaw/extensions/feishu/src/perm-schema.ts (TypeBox → plain JSON Schema).
 */

const TOKEN_TYPES = ["doc", "docx", "sheet", "bitable", "folder", "file", "wiki", "mindnote"];
const MEMBER_TYPES = ["email", "openid", "userid", "unionid", "openchat", "opendepartmentid"];
const PERMISSIONS = ["view", "edit", "full_access"];

export const FeishuPermSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["list", "add", "remove"],
      description: "Permission action to perform",
    },
    token: {
      type: "string",
      description: "File token",
    },
    type: {
      type: "string",
      enum: TOKEN_TYPES,
      description: "File type",
    },
    member_type: {
      type: "string",
      enum: MEMBER_TYPES,
      description: "Member type (for add/remove)",
    },
    member_id: {
      type: "string",
      description: "Member ID — email, open_id, user_id, etc. (for add/remove)",
    },
    perm: {
      type: "string",
      enum: PERMISSIONS,
      description: "Permission level (for add)",
    },
  },
  required: ["action"],
};

export type FeishuPermParams = {
  action: "list" | "add" | "remove";
  token?: string;
  type?: string;
  member_type?: string;
  member_id?: string;
  perm?: string;
};
