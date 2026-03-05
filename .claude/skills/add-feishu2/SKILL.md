---
name: add-feishu2
description: Lightweight Feishu channel — single account, WebSocket only, inspired by CoPaw's simplified approach. Creates a standalone feishu-lite module instead of using the full OpenClaw plugin system.
---

# Add Feishu Channel (Lite)

This skill provides a simpler alternative to the full Feishu integration. Instead of using the 40-file OpenClaw plugin system, it creates a lightweight `feishu-lite` module with:

- Single Feishu app account
- WebSocket long connection only (no webhook option)
- No policy configuration (responds to all messages)
- Message deduplication
- Sender name caching

## Phase 1: Pre-flight

### Check for conflicts

Read `.clawdesktop/state.yaml`. If `feishu` (full version) is in `applied_skills`, this skill conflicts. The user must choose one:

> The full Feishu integration (`/add-feishu1`) is already installed. The lite version conflicts with it.
> To switch to lite: first uninstall the full version, then run this skill.

### Ask the user

AskUserQuestion: Confirm you want the simplified Feishu integration?
- **Yes, lite version** — Single account, WebSocket only, simpler setup
- **No, use full version** — I want the full-featured Feishu integration (use `/add-feishu1` instead)

AskUserQuestion: Do you have a Feishu app created on open.feishu.cn?
- **Yes** — I have App ID and App Secret
- **No** — I need to create one

## Phase 2: Apply Code Changes

### Initialize skills system (if needed)

If `.clawdesktop/` directory doesn't exist:

```bash
npx tsx scripts/apply-skill.ts --init
```

### Apply the skill

```bash
npx tsx scripts/apply-skill.ts .claude/skills/add-feishu2
```

This will:
- Add `electron/channels/feishu-lite/channel.ts` — FeishuLiteChannel class
- Add `electron/channels/feishu-lite/types.ts` — Type definitions
- Add `electron/channels/feishu-lite/index.ts` — Module exports
- Three-way merge `registration.ts` to register the feishu-lite channel
- Verify `@larksuiteoapi/node-sdk` is in dependencies (already present)

### Validate

```bash
pnpm typecheck
pnpm build:vite
```

## Phase 3: Setup

### Create Feishu App (if needed)

> Create a Feishu self-built application:
>
> 1. Go to [Feishu Open Platform](https://open.feishu.cn/app) and log in
> 2. Click "Create Custom App"
> 3. Fill in app name and description
> 4. Go to "Credentials & Basic Info":
>    - Copy **App ID** and **App Secret**
> 5. Enable "Bot" ability
> 6. Go to "Event Subscriptions":
>    - **Enable "Use long connection to receive events"** (this is required for lite mode)
>    - Subscribe to: `im.message.receive_v1`
> 7. Go to "Permissions & Scopes" → Add:
>    - `im:message` — Send messages
>    - `im:message.receive` — Receive messages
>    - `contact:user.base:readonly` — Read user names
> 8. Create version and approve

Wait for App ID and App Secret.

## Phase 4: Configure

Store configuration:

```typescript
const config = {
  appId: '<user-provided>',
  appSecret: '<user-provided>',
};

setSetting('channel:feishu-lite:config', JSON.stringify(config));
```

## Phase 5: Verify

### Restart and test

> 1. Restart ClawDesktop2
> 2. Go to Settings → Channels — "feishu-lite" should show as "connected"
> 3. Open Feishu and send a message to the bot
> 4. The bot should respond

### Troubleshooting

**WebSocket not connecting**
- Ensure "Use long connection to receive events" is enabled
- Check App ID and App Secret are correct
- Verify the app version is published/approved

**Bot not receiving messages**
- Check `im.message.receive_v1` event subscription
- Verify `im:message.receive` permission is approved
- Make sure the bot is added to the chat/group

**Duplicate responses**
- The lite channel includes built-in message deduplication (1000 message cache)
- If duplicates persist, check that only one instance of ClawDesktop2 is running

## Removal

1. Remove feishu-lite config: `setSetting('channel:feishu-lite:config', '')`
2. Delete `electron/channels/feishu-lite/` directory
3. Revert `registration.ts` changes
4. Remove `feishu-lite` from `.clawdesktop/state.yaml`
5. Restart ClawDesktop2
