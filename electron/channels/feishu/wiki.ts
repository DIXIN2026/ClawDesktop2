/**
 * Feishu wiki (knowledge base) tools.
 * Ported from openclaw/extensions/feishu/src/wiki.ts, adapted for ClawDesktop2.
 */

import type * as Lark from "@larksuiteoapi/node-sdk";
import type { OpenClawPluginApi } from "./plugin-adapter.js";
import { listEnabledFeishuAccounts } from "./accounts.js";
import { createFeishuClient } from "./client.js";
import { FeishuWikiSchema, type FeishuWikiParams } from "./wiki-schema.js";
import { resolveToolsConfig } from "./tools-config.js";

// ============ Actions ============

type ObjType = "doc" | "sheet" | "mindnote" | "bitable" | "file" | "docx" | "slides";

const WIKI_ACCESS_HINT =
  "To grant wiki access: Open wiki space → Settings → Members → Add the bot. " +
  "See: https://open.feishu.cn/document/server-docs/docs/wiki-v2/wiki-qa#a40ad4ca";

async function listSpaces(client: Lark.Client) {
  const res = await client.wiki.space.list({});
  if (res.code !== 0) {
    throw new Error(res.msg);
  }

  const spaces =
    res.data?.items?.map((s) => ({
      space_id: s.space_id,
      name: s.name,
      description: s.description,
      visibility: s.visibility,
    })) ?? [];

  return {
    spaces,
    ...(spaces.length === 0 && { hint: WIKI_ACCESS_HINT }),
  };
}

async function listNodes(client: Lark.Client, spaceId: string, parentNodeToken?: string) {
  const res = await client.wiki.spaceNode.list({
    path: { space_id: spaceId },
    params: { parent_node_token: parentNodeToken },
  });
  if (res.code !== 0) {
    throw new Error(res.msg);
  }

  return {
    nodes:
      res.data?.items?.map((n) => ({
        node_token: n.node_token,
        obj_token: n.obj_token,
        obj_type: n.obj_type,
        title: n.title,
        has_child: n.has_child,
      })) ?? [],
  };
}

async function getNode(client: Lark.Client, token: string) {
  const res = await client.wiki.space.getNode({
    params: { token },
  });
  if (res.code !== 0) {
    throw new Error(res.msg);
  }

  const node = res.data?.node;
  return {
    node_token: node?.node_token,
    space_id: node?.space_id,
    obj_token: node?.obj_token,
    obj_type: node?.obj_type,
    title: node?.title,
    parent_node_token: node?.parent_node_token,
    has_child: node?.has_child,
    creator: node?.creator,
    create_time: node?.node_create_time,
  };
}

async function createNode(
  client: Lark.Client,
  spaceId: string,
  title: string,
  objType?: string,
  parentNodeToken?: string,
) {
  const res = await client.wiki.spaceNode.create({
    path: { space_id: spaceId },
    data: {
      obj_type: (objType as ObjType) || "docx",
      node_type: "origin" as const,
      title,
      parent_node_token: parentNodeToken,
    },
  });
  if (res.code !== 0) {
    throw new Error(res.msg);
  }

  const node = res.data?.node;
  return {
    node_token: node?.node_token,
    obj_token: node?.obj_token,
    obj_type: node?.obj_type,
    title: node?.title,
  };
}

async function moveNode(
  client: Lark.Client,
  spaceId: string,
  nodeToken: string,
  targetSpaceId?: string,
  targetParentToken?: string,
) {
  const res = await client.wiki.spaceNode.move({
    path: { space_id: spaceId, node_token: nodeToken },
    data: {
      target_space_id: targetSpaceId || spaceId,
      target_parent_token: targetParentToken,
    },
  });
  if (res.code !== 0) {
    throw new Error(res.msg);
  }

  return { success: true, node_token: res.data?.node?.node_token };
}

async function renameNode(client: Lark.Client, spaceId: string, nodeToken: string, title: string) {
  const res = await client.wiki.spaceNode.updateTitle({
    path: { space_id: spaceId, node_token: nodeToken },
    data: { title },
  });
  if (res.code !== 0) {
    throw new Error(res.msg);
  }

  return { success: true, node_token: nodeToken, title };
}

// ============ Tool Registration ============

export function registerFeishuWikiTools(api: OpenClawPluginApi): void {
  if (!api.config) {
    console.debug("feishu_wiki: No config available, skipping wiki tools");
    return;
  }

  const accounts = listEnabledFeishuAccounts(api.config);
  if (accounts.length === 0) {
    console.debug("feishu_wiki: No Feishu accounts configured, skipping wiki tools");
    return;
  }

  const firstAccount = accounts[0];
  const toolsCfg = resolveToolsConfig(firstAccount.config.tools);
  if (!toolsCfg.wiki) {
    console.debug("feishu_wiki: wiki tool disabled in config");
    return;
  }

  const getClient = () => createFeishuClient(firstAccount);

  api.registerTool({
    name: "feishu_wiki",
    description:
      "Feishu knowledge base operations. Actions: spaces, nodes, get, create, move, rename",
    parameters: FeishuWikiSchema,
    handler: async (params) => {
      const p = params as unknown as FeishuWikiParams;
      try {
        const client = getClient();
        switch (p.action) {
          case "spaces":
            return await listSpaces(client);
          case "nodes":
            return await listNodes(client, p.space_id!, p.parent_node_token);
          case "get":
            return await getNode(client, p.token!);
          case "search":
            return {
              error:
                "Search is not available. Use feishu_wiki with action: 'nodes' to browse or action: 'get' to lookup by token.",
            };
          case "create":
            return await createNode(
              client,
              p.space_id!,
              p.title!,
              p.obj_type,
              p.parent_node_token,
            );
          case "move":
            return await moveNode(
              client,
              p.space_id!,
              p.node_token!,
              p.target_space_id,
              p.target_parent_token,
            );
          case "rename":
            return await renameNode(client, p.space_id!, p.node_token!, p.title!);
          default:
            return { error: `Unknown action: ${p.action}` };
        }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  });

  console.info("feishu_wiki: Registered feishu_wiki tool");
}
