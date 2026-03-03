/**
 * Feishu Desktop Channel — Message sending utilities
 * Supports text, image, and markdown card formats
 */
import * as Lark from '@larksuiteoapi/node-sdk';
import fs from 'fs';

/** Response shape for Feishu message creation/reply APIs */
interface FeishuMessageResponse {
  code?: number;
  msg?: string;
  data?: {
    message_id?: string;
  };
}

/** Response shape for Feishu image upload API */
interface FeishuImageUploadResponse {
  code?: number;
  msg?: string;
  data?: {
    image_key?: string;
  };
  image_key?: string;
}

/**
 * Fix Feishu markdown rendering: add newline before code fences
 * that immediately follow text (Feishu requires blank line before ```)
 */
function fixMarkdownForFeishu(text: string): string {
  return text.replace(/([^\n])\n(```)/g, '$1\n\n$2');
}

/**
 * Send a plain text message to a Feishu chat.
 * Returns the created message ID.
 */
export async function sendTextMessage(
  client: Lark.Client,
  chatId: string,
  text: string,
  replyTo?: string,
): Promise<string> {
  const content = JSON.stringify({ text });

  if (replyTo) {
    const response = (await client.im.message.reply({
      path: { message_id: replyTo },
      data: { content, msg_type: 'text' },
    })) as FeishuMessageResponse;

    if (response.code !== 0) {
      throw new Error(`Feishu text reply failed: ${response.msg ?? `code ${response.code}`}`);
    }
    return response.data?.message_id ?? '';
  }

  const response = (await client.im.message.create({
    params: { receive_id_type: 'chat_id' },
    data: { receive_id: chatId, content, msg_type: 'text' },
  })) as FeishuMessageResponse;

  if (response.code !== 0) {
    throw new Error(`Feishu text send failed: ${response.msg ?? `code ${response.code}`}`);
  }
  return response.data?.message_id ?? '';
}

/**
 * Send a markdown card (interactive message) to a Feishu chat.
 * Cards render markdown properly (code blocks, tables, links, etc.)
 * Uses schema 2.0 format for proper markdown rendering.
 * Returns the created message ID.
 */
export async function sendMarkdownCard(
  client: Lark.Client,
  chatId: string,
  text: string,
  replyTo?: string,
): Promise<string> {
  const fixedText = fixMarkdownForFeishu(text);
  const card = {
    schema: '2.0',
    config: { wide_screen_mode: true },
    body: {
      elements: [{ tag: 'markdown', content: fixedText }],
    },
  };
  const content = JSON.stringify(card);

  if (replyTo) {
    const response = (await client.im.message.reply({
      path: { message_id: replyTo },
      data: { content, msg_type: 'interactive' },
    })) as FeishuMessageResponse;

    if (response.code !== 0) {
      throw new Error(`Feishu card reply failed: ${response.msg ?? `code ${response.code}`}`);
    }
    return response.data?.message_id ?? '';
  }

  const response = (await client.im.message.create({
    params: { receive_id_type: 'chat_id' },
    data: { receive_id: chatId, content, msg_type: 'interactive' },
  })) as FeishuMessageResponse;

  if (response.code !== 0) {
    throw new Error(`Feishu card send failed: ${response.msg ?? `code ${response.code}`}`);
  }
  return response.data?.message_id ?? '';
}

/**
 * Send an image message using an already-uploaded image_key.
 * Returns the created message ID.
 */
export async function sendImageMessage(
  client: Lark.Client,
  chatId: string,
  imageKey: string,
  replyTo?: string,
): Promise<string> {
  const content = JSON.stringify({ image_key: imageKey });

  if (replyTo) {
    const response = (await client.im.message.reply({
      path: { message_id: replyTo },
      data: { content, msg_type: 'image' },
    })) as FeishuMessageResponse;

    if (response.code !== 0) {
      throw new Error(`Feishu image reply failed: ${response.msg ?? `code ${response.code}`}`);
    }
    return response.data?.message_id ?? '';
  }

  const response = (await client.im.message.create({
    params: { receive_id_type: 'chat_id' },
    data: { receive_id: chatId, content, msg_type: 'image' },
  })) as FeishuMessageResponse;

  if (response.code !== 0) {
    throw new Error(`Feishu image send failed: ${response.msg ?? `code ${response.code}`}`);
  }
  return response.data?.message_id ?? '';
}

/**
 * Upload a local image file to Feishu and return its image_key.
 */
export async function uploadImage(
  client: Lark.Client,
  imagePath: string,
): Promise<string> {
  const imageStream = fs.createReadStream(imagePath);

  const response = (await client.im.image.create({
    data: {
      image_type: 'message',
      image: imageStream,
    },
  })) as FeishuImageUploadResponse;

  if (response.code !== undefined && response.code !== 0) {
    throw new Error(`Feishu image upload failed: ${response.msg ?? `code ${response.code}`}`);
  }

  const imageKey = response.image_key ?? response.data?.image_key;
  if (!imageKey) {
    throw new Error('Feishu image upload failed: no image_key returned');
  }

  return imageKey;
}
