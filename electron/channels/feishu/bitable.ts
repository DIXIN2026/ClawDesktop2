/**
 * Feishu Bitable (multi-dimensional table) tools.
 * Ported from openclaw/extensions/feishu/src/bitable.ts, adapted for ClawDesktop2.
 */

import type { OpenClawPluginApi } from "./plugin-adapter.js";
import { createFeishuClient } from "./client.js";
import type { FeishuConfig } from "./types.js";

// ============ Helpers ============

/** Field type ID to human-readable name */
const FIELD_TYPE_NAMES: Record<number, string> = {
  1: "Text",
  2: "Number",
  3: "SingleSelect",
  4: "MultiSelect",
  5: "DateTime",
  7: "Checkbox",
  11: "User",
  13: "Phone",
  15: "URL",
  17: "Attachment",
  18: "SingleLink",
  19: "Lookup",
  20: "Formula",
  21: "DuplexLink",
  22: "Location",
  23: "GroupChat",
  1001: "CreatedTime",
  1002: "ModifiedTime",
  1003: "CreatedUser",
  1004: "ModifiedUser",
  1005: "AutoNumber",
};

// ============ Core Functions ============

/** Parse bitable URL and extract tokens */
function parseBitableUrl(url: string): { token: string; tableId?: string; isWiki: boolean } | null {
  try {
    const u = new URL(url);
    const tableId = u.searchParams.get("table") ?? undefined;

    // Wiki format: /wiki/XXXXX?table=YYY
    const wikiMatch = u.pathname.match(/\/wiki\/([A-Za-z0-9]+)/);
    if (wikiMatch) {
      return { token: wikiMatch[1], tableId, isWiki: true };
    }

    // Base format: /base/XXXXX?table=YYY
    const baseMatch = u.pathname.match(/\/base\/([A-Za-z0-9]+)/);
    if (baseMatch) {
      return { token: baseMatch[1], tableId, isWiki: false };
    }

    return null;
  } catch {
    return null;
  }
}

/** Get app_token from wiki node_token */
async function getAppTokenFromWiki(
  client: ReturnType<typeof createFeishuClient>,
  nodeToken: string,
): Promise<string> {
  const res = await client.wiki.space.getNode({
    params: { token: nodeToken },
  });
  if (res.code !== 0) {
    throw new Error(res.msg);
  }

  const node = res.data?.node;
  if (!node) {
    throw new Error("Node not found");
  }
  if (node.obj_type !== "bitable") {
    throw new Error(`Node is not a bitable (type: ${node.obj_type})`);
  }

  return node.obj_token!;
}

/** Get bitable metadata from URL (handles both /base/ and /wiki/ URLs) */
async function getBitableMeta(client: ReturnType<typeof createFeishuClient>, url: string) {
  const parsed = parseBitableUrl(url);
  if (!parsed) {
    throw new Error("Invalid URL format. Expected /base/XXX or /wiki/XXX URL");
  }

  let appToken: string;
  if (parsed.isWiki) {
    appToken = await getAppTokenFromWiki(client, parsed.token);
  } else {
    appToken = parsed.token;
  }

  const res = await client.bitable.app.get({
    path: { app_token: appToken },
  });
  if (res.code !== 0) {
    throw new Error(res.msg);
  }

  let tables: { table_id: string; name: string }[] = [];
  if (!parsed.tableId) {
    const tablesRes = await client.bitable.appTable.list({
      path: { app_token: appToken },
    });
    if (tablesRes.code === 0) {
      tables = (tablesRes.data?.items ?? []).map((t) => ({
        table_id: t.table_id!,
        name: t.name!,
      }));
    }
  }

  return {
    app_token: appToken,
    table_id: parsed.tableId,
    name: res.data?.app?.name,
    url_type: parsed.isWiki ? "wiki" : "base",
    ...(tables.length > 0 && { tables }),
    hint: parsed.tableId
      ? `Use app_token="${appToken}" and table_id="${parsed.tableId}" for other bitable tools`
      : `Use app_token="${appToken}" for other bitable tools. Select a table_id from the tables list.`,
  };
}

async function listFields(
  client: ReturnType<typeof createFeishuClient>,
  appToken: string,
  tableId: string,
) {
  const res = await client.bitable.appTableField.list({
    path: { app_token: appToken, table_id: tableId },
  });
  if (res.code !== 0) {
    throw new Error(res.msg);
  }

  const fields = res.data?.items ?? [];
  return {
    fields: fields.map((f) => ({
      field_id: f.field_id,
      field_name: f.field_name,
      type: f.type,
      type_name: FIELD_TYPE_NAMES[f.type ?? 0] || `type_${f.type}`,
      is_primary: f.is_primary,
      ...(f.property && { property: f.property }),
    })),
    total: fields.length,
  };
}

async function listRecords(
  client: ReturnType<typeof createFeishuClient>,
  appToken: string,
  tableId: string,
  pageSize?: number,
  pageToken?: string,
) {
  const res = await client.bitable.appTableRecord.list({
    path: { app_token: appToken, table_id: tableId },
    params: {
      page_size: pageSize ?? 100,
      ...(pageToken && { page_token: pageToken }),
    },
  });
  if (res.code !== 0) {
    throw new Error(res.msg);
  }

  return {
    records: res.data?.items ?? [],
    has_more: res.data?.has_more ?? false,
    page_token: res.data?.page_token,
    total: res.data?.total,
  };
}

async function getRecord(
  client: ReturnType<typeof createFeishuClient>,
  appToken: string,
  tableId: string,
  recordId: string,
) {
  const res = await client.bitable.appTableRecord.get({
    path: { app_token: appToken, table_id: tableId, record_id: recordId },
  });
  if (res.code !== 0) {
    throw new Error(res.msg);
  }

  return { record: res.data?.record };
}

async function createRecord(
  client: ReturnType<typeof createFeishuClient>,
  appToken: string,
  tableId: string,
  fields: Record<string, unknown>,
) {
  const res = await client.bitable.appTableRecord.create({
    path: { app_token: appToken, table_id: tableId },
    data: { fields: fields as Record<string, never> },
  });
  if (res.code !== 0) {
    throw new Error(res.msg);
  }

  return { record: res.data?.record };
}

async function updateRecord(
  client: ReturnType<typeof createFeishuClient>,
  appToken: string,
  tableId: string,
  recordId: string,
  fields: Record<string, unknown>,
) {
  const res = await client.bitable.appTableRecord.update({
    path: { app_token: appToken, table_id: tableId, record_id: recordId },
    data: { fields: fields as Record<string, never> },
  });
  if (res.code !== 0) {
    throw new Error(res.msg);
  }

  return { record: res.data?.record };
}

/** Default field types created for new Bitable tables (to be cleaned up) */
const DEFAULT_CLEANUP_FIELD_TYPES = new Set([3, 5, 17]); // SingleSelect, DateTime, Attachment

/** Clean up default placeholder rows and fields in a newly created Bitable table */
async function cleanupNewBitable(
  client: ReturnType<typeof createFeishuClient>,
  appToken: string,
  tableId: string,
  tableName: string,
): Promise<{ cleanedRows: number; cleanedFields: number }> {
  let cleanedRows = 0;
  let cleanedFields = 0;

  // Step 1: Clean up default fields
  const fieldsRes = await client.bitable.appTableField.list({
    path: { app_token: appToken, table_id: tableId },
  });

  if (fieldsRes.code === 0 && fieldsRes.data?.items) {
    // Rename primary field to the table name
    const primaryField = fieldsRes.data.items.find((f) => f.is_primary);
    if (primaryField?.field_id) {
      try {
        const newFieldName = tableName.length <= 20 ? tableName : "Name";
        await client.bitable.appTableField.update({
          path: { app_token: appToken, table_id: tableId, field_id: primaryField.field_id },
          data: { field_name: newFieldName, type: 1 },
        });
        cleanedFields++;
      } catch (err) {
        console.debug(`Failed to rename primary field: ${err}`);
      }
    }

    // Delete default placeholder fields by type
    const defaultFieldsToDelete = fieldsRes.data.items.filter(
      (f) => !f.is_primary && DEFAULT_CLEANUP_FIELD_TYPES.has(f.type ?? 0),
    );

    for (const field of defaultFieldsToDelete) {
      if (field.field_id) {
        try {
          await client.bitable.appTableField.delete({
            path: { app_token: appToken, table_id: tableId, field_id: field.field_id },
          });
          cleanedFields++;
        } catch (err) {
          console.debug(`Failed to delete default field ${field.field_name}: ${err}`);
        }
      }
    }
  }

  // Step 2: Delete empty placeholder rows
  const recordsRes = await client.bitable.appTableRecord.list({
    path: { app_token: appToken, table_id: tableId },
    params: { page_size: 100 },
  });

  if (recordsRes.code === 0 && recordsRes.data?.items) {
    const emptyRecordIds = recordsRes.data.items
      .filter((r) => !r.fields || Object.keys(r.fields).length === 0)
      .map((r) => r.record_id)
      .filter((id): id is string => Boolean(id));

    if (emptyRecordIds.length > 0) {
      try {
        await client.bitable.appTableRecord.batchDelete({
          path: { app_token: appToken, table_id: tableId },
          data: { records: emptyRecordIds },
        });
        cleanedRows = emptyRecordIds.length;
      } catch {
        // Fallback: delete one by one
        for (const recordId of emptyRecordIds) {
          try {
            await client.bitable.appTableRecord.delete({
              path: { app_token: appToken, table_id: tableId, record_id: recordId },
            });
            cleanedRows++;
          } catch (err) {
            console.debug(`Failed to delete empty row ${recordId}: ${err}`);
          }
        }
      }
    }
  }

  return { cleanedRows, cleanedFields };
}

async function createApp(
  client: ReturnType<typeof createFeishuClient>,
  name: string,
  folderToken?: string,
) {
  const res = await client.bitable.app.create({
    data: {
      name,
      ...(folderToken && { folder_token: folderToken }),
    },
  });
  if (res.code !== 0) {
    throw new Error(res.msg);
  }

  const appToken = res.data?.app?.app_token;
  if (!appToken) {
    throw new Error("Failed to create Bitable: no app_token returned");
  }

  let tableId: string | undefined;
  let cleanedRows = 0;
  let cleanedFields = 0;

  try {
    const tablesRes = await client.bitable.appTable.list({
      path: { app_token: appToken },
    });
    if (tablesRes.code === 0 && tablesRes.data?.items && tablesRes.data.items.length > 0) {
      tableId = tablesRes.data.items[0].table_id ?? undefined;
      if (tableId) {
        const cleanup = await cleanupNewBitable(client, appToken, tableId, name);
        cleanedRows = cleanup.cleanedRows;
        cleanedFields = cleanup.cleanedFields;
      }
    }
  } catch (err) {
    console.debug(`Cleanup failed (non-critical): ${err}`);
  }

  return {
    app_token: appToken,
    table_id: tableId,
    name: res.data?.app?.name,
    url: res.data?.app?.url,
    cleaned_placeholder_rows: cleanedRows,
    cleaned_default_fields: cleanedFields,
    hint: tableId
      ? `Table created. Use app_token="${appToken}" and table_id="${tableId}" for other bitable tools.`
      : "Table created. Use feishu_bitable_get_meta to get table_id and field details.",
  };
}

async function createField(
  client: ReturnType<typeof createFeishuClient>,
  appToken: string,
  tableId: string,
  fieldName: string,
  fieldType: number,
  property?: Record<string, unknown>,
) {
  const res = await client.bitable.appTableField.create({
    path: { app_token: appToken, table_id: tableId },
    data: {
      field_name: fieldName,
      type: fieldType,
      ...(property && { property }),
    },
  });
  if (res.code !== 0) {
    throw new Error(res.msg);
  }

  return {
    field_id: res.data?.field?.field_id,
    field_name: res.data?.field?.field_name,
    type: res.data?.field?.type,
    type_name: FIELD_TYPE_NAMES[res.data?.field?.type ?? 0] || `type_${res.data?.field?.type}`,
  };
}

// ============ Schemas ============

const GetMetaSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    url: {
      type: "string",
      description:
        "Bitable URL. Supports both formats: /base/XXX?table=YYY or /wiki/XXX?table=YYY",
    },
  },
  required: ["url"],
};

const ListFieldsSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    app_token: {
      type: "string",
      description: "Bitable app token (use feishu_bitable_get_meta to get from URL)",
    },
    table_id: { type: "string", description: "Table ID (from URL: ?table=YYY)" },
  },
  required: ["app_token", "table_id"],
};

const ListRecordsSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    app_token: {
      type: "string",
      description: "Bitable app token (use feishu_bitable_get_meta to get from URL)",
    },
    table_id: { type: "string", description: "Table ID (from URL: ?table=YYY)" },
    page_size: {
      type: "number",
      description: "Number of records per page (1-500, default 100)",
      minimum: 1,
      maximum: 500,
    },
    page_token: {
      type: "string",
      description: "Pagination token from previous response",
    },
  },
  required: ["app_token", "table_id"],
};

const GetRecordSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    app_token: {
      type: "string",
      description: "Bitable app token (use feishu_bitable_get_meta to get from URL)",
    },
    table_id: { type: "string", description: "Table ID (from URL: ?table=YYY)" },
    record_id: { type: "string", description: "Record ID to retrieve" },
  },
  required: ["app_token", "table_id", "record_id"],
};

const CreateRecordSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    app_token: {
      type: "string",
      description: "Bitable app token (use feishu_bitable_get_meta to get from URL)",
    },
    table_id: { type: "string", description: "Table ID (from URL: ?table=YYY)" },
    fields: {
      type: "object",
      additionalProperties: true,
      description:
        "Field values keyed by field name. Format by type: Text='string', Number=123, SingleSelect='Option', MultiSelect=['A','B'], DateTime=timestamp_ms, User=[{id:'ou_xxx'}], URL={text:'Display',link:'https://...'}",
    },
  },
  required: ["app_token", "table_id", "fields"],
};

const UpdateRecordSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    app_token: {
      type: "string",
      description: "Bitable app token (use feishu_bitable_get_meta to get from URL)",
    },
    table_id: { type: "string", description: "Table ID (from URL: ?table=YYY)" },
    record_id: { type: "string", description: "Record ID to update" },
    fields: {
      type: "object",
      additionalProperties: true,
      description: "Field values to update (same format as create_record)",
    },
  },
  required: ["app_token", "table_id", "record_id", "fields"],
};

const CreateAppSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    name: { type: "string", description: "Name for the new Bitable application" },
    folder_token: {
      type: "string",
      description: "Optional folder token to place the Bitable in a specific folder",
    },
  },
  required: ["name"],
};

const CreateFieldSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    app_token: {
      type: "string",
      description:
        "Bitable app token (use feishu_bitable_get_meta to get from URL, or feishu_bitable_create_app to create new)",
    },
    table_id: { type: "string", description: "Table ID (from URL: ?table=YYY)" },
    field_name: { type: "string", description: "Name for the new field" },
    field_type: {
      type: "number",
      description:
        "Field type ID: 1=Text, 2=Number, 3=SingleSelect, 4=MultiSelect, 5=DateTime, 7=Checkbox, 11=User, 13=Phone, 15=URL, 17=Attachment, 18=SingleLink, 19=Lookup, 20=Formula, 21=DuplexLink, 22=Location, 23=GroupChat, 1001=CreatedTime, 1002=ModifiedTime, 1003=CreatedUser, 1004=ModifiedUser, 1005=AutoNumber",
      minimum: 1,
    },
    property: {
      type: "object",
      additionalProperties: true,
      description:
        "Field-specific properties (e.g., options for SingleSelect, format for Number)",
    },
  },
  required: ["app_token", "table_id", "field_name", "field_type"],
};

// ============ Tool Registration ============

function wrapHandler(fn: (params: Record<string, unknown>) => Promise<unknown>) {
  return async (params: Record<string, unknown>) => {
    try {
      return await fn(params);
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  };
}

export function registerFeishuBitableTools(api: OpenClawPluginApi): void {
  const feishuCfg = api.config?.channels?.feishu as FeishuConfig | undefined;
  if (!feishuCfg?.appId || !feishuCfg?.appSecret) {
    console.debug("feishu_bitable: Feishu credentials not configured, skipping bitable tools");
    return;
  }

  const getClient = () => createFeishuClient(feishuCfg);

  api.registerTool({
    name: "feishu_bitable_get_meta",
    description:
      "Parse a Bitable URL and get app_token, table_id, and table list. Use this first when given a /wiki/ or /base/ URL.",
    parameters: GetMetaSchema,
    handler: wrapHandler(async (params) => {
      const { url } = params as { url: string };
      return getBitableMeta(getClient(), url);
    }),
  });

  api.registerTool({
    name: "feishu_bitable_list_fields",
    description: "List all fields (columns) in a Bitable table with their types and properties",
    parameters: ListFieldsSchema,
    handler: wrapHandler(async (params) => {
      const { app_token, table_id } = params as { app_token: string; table_id: string };
      return listFields(getClient(), app_token, table_id);
    }),
  });

  api.registerTool({
    name: "feishu_bitable_list_records",
    description: "List records (rows) from a Bitable table with pagination support",
    parameters: ListRecordsSchema,
    handler: wrapHandler(async (params) => {
      const { app_token, table_id, page_size, page_token } = params as {
        app_token: string;
        table_id: string;
        page_size?: number;
        page_token?: string;
      };
      return listRecords(getClient(), app_token, table_id, page_size, page_token);
    }),
  });

  api.registerTool({
    name: "feishu_bitable_get_record",
    description: "Get a single record by ID from a Bitable table",
    parameters: GetRecordSchema,
    handler: wrapHandler(async (params) => {
      const { app_token, table_id, record_id } = params as {
        app_token: string;
        table_id: string;
        record_id: string;
      };
      return getRecord(getClient(), app_token, table_id, record_id);
    }),
  });

  api.registerTool({
    name: "feishu_bitable_create_record",
    description: "Create a new record (row) in a Bitable table",
    parameters: CreateRecordSchema,
    handler: wrapHandler(async (params) => {
      const { app_token, table_id, fields } = params as {
        app_token: string;
        table_id: string;
        fields: Record<string, unknown>;
      };
      return createRecord(getClient(), app_token, table_id, fields);
    }),
  });

  api.registerTool({
    name: "feishu_bitable_update_record",
    description: "Update an existing record (row) in a Bitable table",
    parameters: UpdateRecordSchema,
    handler: wrapHandler(async (params) => {
      const { app_token, table_id, record_id, fields } = params as {
        app_token: string;
        table_id: string;
        record_id: string;
        fields: Record<string, unknown>;
      };
      return updateRecord(getClient(), app_token, table_id, record_id, fields);
    }),
  });

  api.registerTool({
    name: "feishu_bitable_create_app",
    description: "Create a new Bitable (multidimensional table) application",
    parameters: CreateAppSchema,
    handler: wrapHandler(async (params) => {
      const { name, folder_token } = params as { name: string; folder_token?: string };
      return createApp(getClient(), name, folder_token);
    }),
  });

  api.registerTool({
    name: "feishu_bitable_create_field",
    description: "Create a new field (column) in a Bitable table",
    parameters: CreateFieldSchema,
    handler: wrapHandler(async (params) => {
      const { app_token, table_id, field_name, field_type, property } = params as {
        app_token: string;
        table_id: string;
        field_name: string;
        field_type: number;
        property?: Record<string, unknown>;
      };
      return createField(getClient(), app_token, table_id, field_name, field_type, property);
    }),
  });

  console.info("feishu_bitable: Registered 8 bitable tools");
}
