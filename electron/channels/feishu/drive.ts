/**
 * Feishu drive (cloud storage) tools.
 * Ported from openclaw/extensions/feishu/src/drive.ts, adapted for ClawDesktop2.
 */

import type * as Lark from "@larksuiteoapi/node-sdk";
import type { OpenClawPluginApi } from "./plugin-adapter.js";
import { listEnabledFeishuAccounts } from "./accounts.js";
import { createFeishuClient } from "./client.js";
import { FeishuDriveSchema, type FeishuDriveParams } from "./drive-schema.js";
import { resolveToolsConfig } from "./tools-config.js";

// ============ Actions ============

async function getRootFolderToken(client: Lark.Client): Promise<string> {
  const domain = (client as unknown as Record<string, unknown>).domain ?? "https://open.feishu.cn";
  const res = await ((client as unknown as Record<string, unknown>).httpInstance as {
    get: (url: string) => Promise<{ code: number; msg?: string; data?: { token?: string } }>;
  }).get(`${domain as string}/open-apis/drive/explorer/v2/root_folder/meta`);
  if (res.code !== 0) {
    throw new Error(res.msg ?? "Failed to get root folder");
  }
  const token = res.data?.token;
  if (!token) {
    throw new Error("Root folder token not found");
  }
  return token;
}

async function listFolder(client: Lark.Client, folderToken?: string) {
  const validFolderToken = folderToken && folderToken !== "0" ? folderToken : undefined;
  const res = await client.drive.file.list({
    params: validFolderToken ? { folder_token: validFolderToken } : {},
  });
  if (res.code !== 0) {
    throw new Error(res.msg);
  }

  return {
    files:
      res.data?.files?.map((f) => ({
        token: f.token,
        name: f.name,
        type: f.type,
        url: f.url,
        created_time: f.created_time,
        modified_time: f.modified_time,
        owner_id: f.owner_id,
      })) ?? [],
    next_page_token: res.data?.next_page_token,
  };
}

async function getFileInfo(client: Lark.Client, fileToken: string, folderToken?: string) {
  const res = await client.drive.file.list({
    params: folderToken ? { folder_token: folderToken } : {},
  });
  if (res.code !== 0) {
    throw new Error(res.msg);
  }

  const file = res.data?.files?.find((f) => f.token === fileToken);
  if (!file) {
    throw new Error(`File not found: ${fileToken}`);
  }

  return {
    token: file.token,
    name: file.name,
    type: file.type,
    url: file.url,
    created_time: file.created_time,
    modified_time: file.modified_time,
    owner_id: file.owner_id,
  };
}

async function createFolder(client: Lark.Client, name: string, folderToken?: string) {
  let effectiveToken = folderToken && folderToken !== "0" ? folderToken : "0";
  if (effectiveToken === "0") {
    try {
      effectiveToken = await getRootFolderToken(client);
    } catch {
      // ignore and keep "0"
    }
  }

  const res = await client.drive.file.createFolder({
    data: { name, folder_token: effectiveToken },
  });
  if (res.code !== 0) {
    throw new Error(res.msg);
  }

  return { token: res.data?.token, url: res.data?.url };
}

type DriveFileType =
  | "doc"
  | "docx"
  | "sheet"
  | "bitable"
  | "folder"
  | "file"
  | "mindnote"
  | "slides";
type DriveDeleteType = DriveFileType | "shortcut";

async function moveFile(client: Lark.Client, fileToken: string, type: string, folderToken: string) {
  const res = await client.drive.file.move({
    path: { file_token: fileToken },
    data: { type: type as DriveFileType, folder_token: folderToken },
  });
  if (res.code !== 0) {
    throw new Error(res.msg);
  }

  return { success: true, task_id: res.data?.task_id };
}

async function deleteFile(client: Lark.Client, fileToken: string, type: string) {
  const res = await client.drive.file.delete({
    path: { file_token: fileToken },
    params: { type: type as DriveDeleteType },
  });
  if (res.code !== 0) {
    throw new Error(res.msg);
  }

  return { success: true, task_id: res.data?.task_id };
}

// ============ Tool Registration ============

export function registerFeishuDriveTools(api: OpenClawPluginApi): void {
  if (!api.config) {
    console.debug("feishu_drive: No config available, skipping drive tools");
    return;
  }

  const accounts = listEnabledFeishuAccounts(api.config);
  if (accounts.length === 0) {
    console.debug("feishu_drive: No Feishu accounts configured, skipping drive tools");
    return;
  }

  const firstAccount = accounts[0];
  const toolsCfg = resolveToolsConfig(firstAccount.config.tools);
  if (!toolsCfg.drive) {
    console.debug("feishu_drive: drive tool disabled in config");
    return;
  }

  const getClient = () => createFeishuClient(firstAccount);

  api.registerTool({
    name: "feishu_drive",
    description:
      "Feishu cloud storage operations. Actions: list, info, create_folder, move, delete",
    parameters: FeishuDriveSchema,
    handler: async (params) => {
      const p = params as unknown as FeishuDriveParams;
      try {
        const client = getClient();
        switch (p.action) {
          case "list":
            return await listFolder(client, p.folder_token);
          case "info":
            return await getFileInfo(client, p.file_token!);
          case "create_folder":
            return await createFolder(client, p.name!, p.folder_token);
          case "move":
            return await moveFile(client, p.file_token!, p.type!, p.folder_token!);
          case "delete":
            return await deleteFile(client, p.file_token!, p.type!);
          default:
            return { error: `Unknown action: ${p.action}` };
        }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  });

  console.info("feishu_drive: Registered feishu_drive tool");
}
