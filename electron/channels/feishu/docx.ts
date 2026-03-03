/**
 * Feishu document tools.
 * Ported from openclaw/extensions/feishu/src/docx.ts, adapted for ClawDesktop2.
 */

import { Readable } from "stream";
import type * as Lark from "@larksuiteoapi/node-sdk";
import type { OpenClawPluginApi } from "./plugin-adapter.js";
import { listEnabledFeishuAccounts } from "./accounts.js";
import { createFeishuClient } from "./client.js";
import { FeishuDocSchema, type FeishuDocParams } from "./doc-schema.js";
import { resolveToolsConfig } from "./tools-config.js";

// ============ Helpers ============

/** Extract image URLs from markdown content */
function extractImageUrls(markdown: string): string[] {
  const regex = /!\[[^\]]*\]\(([^)]+)\)/g;
  const urls: string[] = [];
  let match;
  while ((match = regex.exec(markdown)) !== null) {
    const url = match[1].trim();
    if (url.startsWith("http://") || url.startsWith("https://")) {
      urls.push(url);
    }
  }
  return urls;
}

const BLOCK_TYPE_NAMES: Record<number, string> = {
  1: "Page",
  2: "Text",
  3: "Heading1",
  4: "Heading2",
  5: "Heading3",
  12: "Bullet",
  13: "Ordered",
  14: "Code",
  15: "Quote",
  17: "Todo",
  18: "Bitable",
  21: "Diagram",
  22: "Divider",
  23: "File",
  27: "Image",
  30: "Sheet",
  31: "Table",
  32: "TableCell",
};

// Block types that cannot be created via documentBlockChildren.create API
const UNSUPPORTED_CREATE_TYPES = new Set([31, 32]);

/** Clean blocks for insertion (remove unsupported types and read-only fields) */
function cleanBlocksForInsert(
  blocks: Record<string, unknown>[],
): { cleaned: Record<string, unknown>[]; skipped: string[] } {
  const skipped: string[] = [];
  const cleaned = blocks
    .filter((block) => {
      const blockType = block.block_type as number;
      if (UNSUPPORTED_CREATE_TYPES.has(blockType)) {
        const typeName = BLOCK_TYPE_NAMES[blockType] || `type_${blockType}`;
        skipped.push(typeName);
        return false;
      }
      return true;
    })
    .map((block) => {
      const blockType = block.block_type as number;
      if (blockType === 31 && (block.table as Record<string, unknown>)?.merge_info) {
        const table = block.table as Record<string, unknown>;
        const { merge_info: _merge_info, ...tableRest } = table;
        return { ...block, table: tableRest };
      }
      return block;
    });
  return { cleaned, skipped };
}

// ============ Core Functions ============

async function convertMarkdown(client: Lark.Client, markdown: string) {
  const res = await client.docx.document.convert({
    data: { content_type: "markdown", content: markdown },
  });
  if (res.code !== 0) {
    throw new Error(res.msg);
  }
  return {
    blocks: (res.data?.blocks ?? []) as Record<string, unknown>[],
    firstLevelBlockIds: (res.data?.first_level_block_ids ?? []) as string[],
  };
}

function sortBlocksByFirstLevel(
  blocks: Record<string, unknown>[],
  firstLevelIds: string[],
): Record<string, unknown>[] {
  if (!firstLevelIds || firstLevelIds.length === 0) return blocks;
  const sorted = firstLevelIds
    .map((id) => blocks.find((b) => (b as { block_id?: string }).block_id === id))
    .filter(Boolean) as Record<string, unknown>[];
  const sortedIds = new Set(firstLevelIds);
  const remaining = blocks.filter(
    (b) => !sortedIds.has((b as { block_id?: string }).block_id ?? ""),
  );
  return [...sorted, ...remaining];
}

async function insertBlocks(
  client: Lark.Client,
  docToken: string,
  blocks: Record<string, unknown>[],
  parentBlockId?: string,
): Promise<{ children: Record<string, unknown>[]; skipped: string[] }> {
  const { cleaned, skipped } = cleanBlocksForInsert(blocks);
  const blockId = parentBlockId ?? docToken;

  if (cleaned.length === 0) {
    return { children: [], skipped };
  }

  const res = await client.docx.documentBlockChildren.create({
    path: { document_id: docToken, block_id: blockId },
    data: { children: cleaned as never },
  });
  if (res.code !== 0) {
    throw new Error(res.msg);
  }
  return {
    children: (res.data?.children ?? []) as Record<string, unknown>[],
    skipped,
  };
}

async function clearDocumentContent(client: Lark.Client, docToken: string) {
  const existing = await client.docx.documentBlock.list({
    path: { document_id: docToken },
  });
  if (existing.code !== 0) {
    throw new Error(existing.msg);
  }

  const childIds =
    existing.data?.items
      ?.filter((b) => b.parent_id === docToken && b.block_type !== 1)
      .map((b) => b.block_id) ?? [];

  if (childIds.length > 0) {
    const res = await client.docx.documentBlockChildren.batchDelete({
      path: { document_id: docToken, block_id: docToken },
      data: { start_index: 0, end_index: childIds.length },
    });
    if (res.code !== 0) {
      throw new Error(res.msg);
    }
  }

  return childIds.length;
}

async function uploadImageToDocx(
  client: Lark.Client,
  blockId: string,
  imageBuffer: Buffer,
  fileName: string,
): Promise<string> {
  const res = await client.drive.media.uploadAll({
    data: {
      file_name: fileName,
      parent_type: "docx_image",
      parent_node: blockId,
      size: imageBuffer.length,
      file: Readable.from(imageBuffer) as never,
    },
  });

  const fileToken = res?.file_token;
  if (!fileToken) {
    throw new Error("Image upload failed: no file_token returned");
  }
  return fileToken;
}

/** Download an image by URL using plain fetch (replaces openclaw's fetchRemoteMedia) */
async function downloadImage(url: string, maxBytes: number): Promise<Buffer> {
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Failed to fetch image: ${resp.status} ${resp.statusText}`);
  }
  const arrayBuf = await resp.arrayBuffer();
  const buf = Buffer.from(arrayBuf);
  if (buf.length > maxBytes) {
    throw new Error(`Image too large: ${buf.length} bytes (max ${maxBytes})`);
  }
  return buf;
}

async function processImages(
  client: Lark.Client,
  docToken: string,
  markdown: string,
  insertedBlocks: Record<string, unknown>[],
  maxBytes: number,
): Promise<number> {
  const imageUrls = extractImageUrls(markdown);
  if (imageUrls.length === 0) {
    return 0;
  }

  const imageBlocks = insertedBlocks.filter(
    (b) => (b as { block_type?: number }).block_type === 27,
  );

  let processed = 0;
  for (let i = 0; i < Math.min(imageUrls.length, imageBlocks.length); i++) {
    const url = imageUrls[i];
    const blockId = (imageBlocks[i] as { block_id?: string }).block_id;
    if (!blockId) continue;

    try {
      const buffer = await downloadImage(url, maxBytes);
      const urlPath = new URL(url).pathname;
      const fileName = urlPath.split("/").pop() || `image_${i}.png`;
      const fileToken = await uploadImageToDocx(client, blockId, buffer, fileName);

      await client.docx.documentBlock.patch({
        path: { document_id: docToken, block_id: blockId },
        data: { replace_image: { token: fileToken } },
      });

      processed++;
    } catch (err) {
      console.error(`Failed to process image ${url}:`, err);
    }
  }

  return processed;
}

// ============ Actions ============

const STRUCTURED_BLOCK_TYPES = new Set([14, 18, 21, 23, 27, 30, 31, 32]);

async function readDoc(client: Lark.Client, docToken: string) {
  const [contentRes, infoRes, blocksRes] = await Promise.all([
    client.docx.document.rawContent({ path: { document_id: docToken } }),
    client.docx.document.get({ path: { document_id: docToken } }),
    client.docx.documentBlock.list({ path: { document_id: docToken } }),
  ]);

  if (contentRes.code !== 0) {
    throw new Error(contentRes.msg);
  }

  const blocks = blocksRes.data?.items ?? [];
  const blockCounts: Record<string, number> = {};
  const structuredTypes: string[] = [];

  for (const b of blocks) {
    const type = b.block_type ?? 0;
    const name = BLOCK_TYPE_NAMES[type] || `type_${type}`;
    blockCounts[name] = (blockCounts[name] || 0) + 1;

    if (STRUCTURED_BLOCK_TYPES.has(type) && !structuredTypes.includes(name)) {
      structuredTypes.push(name);
    }
  }

  let hint: string | undefined;
  if (structuredTypes.length > 0) {
    hint = `This document contains ${structuredTypes.join(", ")} which are NOT included in the plain text above. Use feishu_doc with action: "list_blocks" to get full content.`;
  }

  return {
    title: infoRes.data?.document?.title,
    content: contentRes.data?.content,
    revision_id: infoRes.data?.document?.revision_id,
    block_count: blocks.length,
    block_types: blockCounts,
    ...(hint && { hint }),
  };
}

async function createDoc(client: Lark.Client, title: string, folderToken?: string) {
  const res = await client.docx.document.create({
    data: { title, folder_token: folderToken },
  });
  if (res.code !== 0) {
    throw new Error(res.msg);
  }
  const doc = res.data?.document;
  return {
    document_id: doc?.document_id,
    title: doc?.title,
    url: `https://feishu.cn/docx/${doc?.document_id}`,
  };
}

async function writeDoc(client: Lark.Client, docToken: string, markdown: string, maxBytes: number) {
  const deleted = await clearDocumentContent(client, docToken);

  const { blocks, firstLevelBlockIds } = await convertMarkdown(client, markdown);
  if (blocks.length === 0) {
    return { success: true, blocks_deleted: deleted, blocks_added: 0, images_processed: 0 };
  }
  const sortedBlocks = sortBlocksByFirstLevel(blocks, firstLevelBlockIds);

  const { children: inserted, skipped } = await insertBlocks(client, docToken, sortedBlocks);
  const imagesProcessed = await processImages(client, docToken, markdown, inserted, maxBytes);

  return {
    success: true,
    blocks_deleted: deleted,
    blocks_added: inserted.length,
    images_processed: imagesProcessed,
    ...(skipped.length > 0 && {
      warning: `Skipped unsupported block types: ${skipped.join(", ")}. Tables are not supported via this API.`,
    }),
  };
}

async function appendDoc(
  client: Lark.Client,
  docToken: string,
  markdown: string,
  maxBytes: number,
) {
  const { blocks, firstLevelBlockIds } = await convertMarkdown(client, markdown);
  if (blocks.length === 0) {
    throw new Error("Content is empty");
  }
  const sortedBlocks = sortBlocksByFirstLevel(blocks, firstLevelBlockIds);

  const { children: inserted, skipped } = await insertBlocks(client, docToken, sortedBlocks);
  const imagesProcessed = await processImages(client, docToken, markdown, inserted, maxBytes);

  return {
    success: true,
    blocks_added: inserted.length,
    images_processed: imagesProcessed,
    block_ids: inserted.map((b) => (b as { block_id?: string }).block_id),
    ...(skipped.length > 0 && {
      warning: `Skipped unsupported block types: ${skipped.join(", ")}. Tables are not supported via this API.`,
    }),
  };
}

async function updateBlock(
  client: Lark.Client,
  docToken: string,
  blockId: string,
  content: string,
) {
  const blockInfo = await client.docx.documentBlock.get({
    path: { document_id: docToken, block_id: blockId },
  });
  if (blockInfo.code !== 0) {
    throw new Error(blockInfo.msg);
  }

  const res = await client.docx.documentBlock.patch({
    path: { document_id: docToken, block_id: blockId },
    data: {
      update_text_elements: {
        elements: [{ text_run: { content } }],
      },
    },
  });
  if (res.code !== 0) {
    throw new Error(res.msg);
  }

  return { success: true, block_id: blockId };
}

async function deleteBlock(client: Lark.Client, docToken: string, blockId: string) {
  const blockInfo = await client.docx.documentBlock.get({
    path: { document_id: docToken, block_id: blockId },
  });
  if (blockInfo.code !== 0) {
    throw new Error(blockInfo.msg);
  }

  const parentId = blockInfo.data?.block?.parent_id ?? docToken;

  const children = await client.docx.documentBlockChildren.get({
    path: { document_id: docToken, block_id: parentId },
  });
  if (children.code !== 0) {
    throw new Error(children.msg);
  }

  const items = children.data?.items ?? [];
  const index = items.findIndex(
    (item) => (item as { block_id?: string }).block_id === blockId,
  );
  if (index === -1) {
    throw new Error("Block not found");
  }

  const res = await client.docx.documentBlockChildren.batchDelete({
    path: { document_id: docToken, block_id: parentId },
    data: { start_index: index, end_index: index + 1 },
  });
  if (res.code !== 0) {
    throw new Error(res.msg);
  }

  return { success: true, deleted_block_id: blockId };
}

async function listBlocks(client: Lark.Client, docToken: string) {
  const res = await client.docx.documentBlock.list({
    path: { document_id: docToken },
  });
  if (res.code !== 0) {
    throw new Error(res.msg);
  }

  return { blocks: res.data?.items ?? [] };
}

async function getBlock(client: Lark.Client, docToken: string, blockId: string) {
  const res = await client.docx.documentBlock.get({
    path: { document_id: docToken, block_id: blockId },
  });
  if (res.code !== 0) {
    throw new Error(res.msg);
  }

  return { block: res.data?.block };
}

async function listAppScopes(client: Lark.Client) {
  const res = await client.application.scope.list({});
  if (res.code !== 0) {
    throw new Error(res.msg);
  }

  const scopes = res.data?.scopes ?? [];
  const granted = scopes.filter((s) => s.grant_status === 1);
  const pending = scopes.filter((s) => s.grant_status !== 1);

  return {
    granted: granted.map((s) => ({ name: s.scope_name, type: s.scope_type })),
    pending: pending.map((s) => ({ name: s.scope_name, type: s.scope_type })),
    summary: `${granted.length} granted, ${pending.length} pending`,
  };
}

// ============ Tool Registration ============

export function registerFeishuDocTools(api: OpenClawPluginApi): void {
  if (!api.config) {
    console.debug("feishu_doc: No config available, skipping doc tools");
    return;
  }

  const accounts = listEnabledFeishuAccounts(api.config);
  if (accounts.length === 0) {
    console.debug("feishu_doc: No Feishu accounts configured, skipping doc tools");
    return;
  }

  const firstAccount = accounts[0];
  const toolsCfg = resolveToolsConfig(firstAccount.config.tools);
  const mediaMaxBytes = (firstAccount.config?.mediaMaxMb ?? 30) * 1024 * 1024;

  const getClient = () => createFeishuClient(firstAccount);
  const registered: string[] = [];

  if (toolsCfg.doc) {
    api.registerTool({
      name: "feishu_doc",
      description:
        "Feishu document operations. Actions: read, write, append, create, list_blocks, get_block, update_block, delete_block",
      parameters: FeishuDocSchema,
      handler: async (params) => {
        const p = params as unknown as FeishuDocParams;
        try {
          const client = getClient();
          switch (p.action) {
            case "read":
              return await readDoc(client, p.doc_token!);
            case "write":
              return await writeDoc(client, p.doc_token!, p.content!, mediaMaxBytes);
            case "append":
              return await appendDoc(client, p.doc_token!, p.content!, mediaMaxBytes);
            case "create":
              return await createDoc(client, p.title!, p.folder_token);
            case "list_blocks":
              return await listBlocks(client, p.doc_token!);
            case "get_block":
              return await getBlock(client, p.doc_token!, p.block_id!);
            case "update_block":
              return await updateBlock(client, p.doc_token!, p.block_id!, p.content!);
            case "delete_block":
              return await deleteBlock(client, p.doc_token!, p.block_id!);
            default:
              return { error: `Unknown action: ${p.action}` };
          }
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    });
    registered.push("feishu_doc");
  }

  if (toolsCfg.scopes) {
    api.registerTool({
      name: "feishu_app_scopes",
      description:
        "List current app permissions (scopes). Use to debug permission issues or check available capabilities.",
      parameters: { type: "object", properties: {} },
      handler: async () => {
        try {
          return await listAppScopes(getClient());
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    });
    registered.push("feishu_app_scopes");
  }

  if (registered.length > 0) {
    console.info(`feishu_doc: Registered ${registered.join(", ")}`);
  }
}
