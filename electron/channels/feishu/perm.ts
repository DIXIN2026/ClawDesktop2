/**
 * Feishu permission management tools.
 * Ported from openclaw/extensions/feishu/src/perm.ts, adapted for ClawDesktop2.
 */

import type * as Lark from "@larksuiteoapi/node-sdk";
import type { OpenClawPluginApi } from "./plugin-adapter.js";
import { listEnabledFeishuAccounts } from "./accounts.js";
import { createFeishuClient } from "./client.js";
import { FeishuPermSchema, type FeishuPermParams } from "./perm-schema.js";
import { resolveToolsConfig } from "./tools-config.js";

// ============ Types ============

type ListTokenType =
  | "doc"
  | "sheet"
  | "file"
  | "wiki"
  | "bitable"
  | "docx"
  | "mindnote"
  | "minutes"
  | "slides";
type CreateTokenType =
  | "doc"
  | "sheet"
  | "file"
  | "wiki"
  | "bitable"
  | "docx"
  | "folder"
  | "mindnote"
  | "minutes"
  | "slides";
type MemberType =
  | "email"
  | "openid"
  | "unionid"
  | "openchat"
  | "opendepartmentid"
  | "userid"
  | "groupid"
  | "wikispaceid";
type PermType = "view" | "edit" | "full_access";

// ============ Actions ============

async function listMembers(client: Lark.Client, token: string, type: string) {
  const res = await client.drive.permissionMember.list({
    path: { token },
    params: { type: type as ListTokenType },
  });
  if (res.code !== 0) {
    throw new Error(res.msg);
  }

  return {
    members:
      res.data?.items?.map((m) => ({
        member_type: m.member_type,
        member_id: m.member_id,
        perm: m.perm,
        name: m.name,
      })) ?? [],
  };
}

async function addMember(
  client: Lark.Client,
  token: string,
  type: string,
  memberType: string,
  memberId: string,
  perm: string,
) {
  const res = await client.drive.permissionMember.create({
    path: { token },
    params: { type: type as CreateTokenType, need_notification: false },
    data: {
      member_type: memberType as MemberType,
      member_id: memberId,
      perm: perm as PermType,
    },
  });
  if (res.code !== 0) {
    throw new Error(res.msg);
  }

  return { success: true, member: res.data?.member };
}

async function removeMember(
  client: Lark.Client,
  token: string,
  type: string,
  memberType: string,
  memberId: string,
) {
  const res = await client.drive.permissionMember.delete({
    path: { token, member_id: memberId },
    params: { type: type as CreateTokenType, member_type: memberType as MemberType },
  });
  if (res.code !== 0) {
    throw new Error(res.msg);
  }

  return { success: true };
}

// ============ Tool Registration ============

export function registerFeishuPermTools(api: OpenClawPluginApi): void {
  if (!api.config) {
    console.debug("feishu_perm: No config available, skipping perm tools");
    return;
  }

  const accounts = listEnabledFeishuAccounts(api.config);
  if (accounts.length === 0) {
    console.debug("feishu_perm: No Feishu accounts configured, skipping perm tools");
    return;
  }

  const firstAccount = accounts[0];
  const toolsCfg = resolveToolsConfig(firstAccount.config.tools);
  if (!toolsCfg.perm) {
    console.debug("feishu_perm: perm tool disabled in config (default: false)");
    return;
  }

  const getClient = () => createFeishuClient(firstAccount);

  api.registerTool({
    name: "feishu_perm",
    description: "Feishu permission management. Actions: list, add, remove",
    parameters: FeishuPermSchema,
    handler: async (params) => {
      const p = params as unknown as FeishuPermParams;
      try {
        const client = getClient();
        switch (p.action) {
          case "list":
            return await listMembers(client, p.token!, p.type!);
          case "add":
            return await addMember(
              client,
              p.token!,
              p.type!,
              p.member_type!,
              p.member_id!,
              p.perm!,
            );
          case "remove":
            return await removeMember(client, p.token!, p.type!, p.member_type!, p.member_id!);
          default:
            return { error: `Unknown action: ${p.action}` };
        }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  });

  console.info("feishu_perm: Registered feishu_perm tool");
}
