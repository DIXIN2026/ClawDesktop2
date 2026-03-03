/**
 * JSON Schema definitions for Feishu drive tools.
 * Ported from openclaw/extensions/feishu/src/drive-schema.ts (TypeBox → plain JSON Schema).
 */

const FILE_TYPES = ["doc", "docx", "sheet", "bitable", "folder", "file", "mindnote", "shortcut"];

export const FeishuDriveSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["list", "info", "create_folder", "move", "delete"],
      description: "Drive action to perform",
    },
    folder_token: {
      type: "string",
      description: "Folder token (optional for list/create_folder — omit for root; required for move)",
    },
    file_token: {
      type: "string",
      description: "File or folder token (for info, move, delete)",
    },
    type: {
      type: "string",
      enum: FILE_TYPES,
      description: "File type (for info, move, delete)",
    },
    name: {
      type: "string",
      description: "Folder name (for create_folder)",
    },
  },
  required: ["action"],
};

export type FeishuDriveParams = {
  action: "list" | "info" | "create_folder" | "move" | "delete";
  folder_token?: string;
  file_token?: string;
  type?: string;
  name?: string;
};
