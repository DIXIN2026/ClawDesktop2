---
name: add-feishu1
description: Full-featured Feishu channel configuration using the existing OpenClaw plugin implementation. Enhances registration.ts to properly bridge Feishu WebSocket events to ChannelManager.
---

# Add Feishu Channel (Full)

This skill configures and activates the complete Feishu integration in ClawDesktop2. The Feishu code already exists in `electron/channels/feishu/` (40 files) — this skill enhances `registration.ts` to create a fully functional bridge between the Feishu SDK and the ChannelManager system.

## Phase 1: Pre-flight

### Check current state

Read `.clawdesktop/state.yaml`. If `feishu` is in `applied_skills`, the registration enhancement is already applied. Skip to Phase 3 (Setup).

Also check if `feishu-lite` is installed — this skill conflicts with `add-feishu2`.

### Ask the user

AskUserQuestion: Feishu connection mode?
- **WebSocket (recommended)** — Long-lived connection via Lark SDK's WSClient. No public URL needed.
- **Webhook** — Requires a publicly accessible URL for event callbacks.

AskUserQuestion: Do you need multi-account support?
- **Single account** — One Feishu app for the bot
- **Multiple accounts** — Several Feishu apps, each with different permissions/groups

AskUserQuestion: Do you have a Feishu app created on open.feishu.cn?
- **Yes** — I have appId and appSecret ready
- **No** — I need to create one first

## Phase 2: Apply Code Changes

### Initialize skills system (if needed)

If `.clawdesktop/` directory doesn't exist:

```bash
npx tsx scripts/apply-skill.ts --init
```

### Apply the skill

```bash
npx tsx scripts/apply-skill.ts .claude/skills/add-feishu1
```

This three-way merges into `registration.ts` to:
- Read `getSetting('channel:feishu:config')` and parse the stored configuration
- Import the existing `monitorFeishuProvider` and `sendMessageFeishu` functions
- Create a proper `ChannelInstance` that bridges Feishu WebSocket events to ChannelManager
- Support both WebSocket and webhook connection modes
- Handle message dispatch from Feishu events to the unified message pipeline

If merge conflicts occur, read `modify/electron/channels/registration.ts.intent.md` for guidance.

### Validate

```bash
pnpm typecheck
pnpm build:vite
```

## Phase 3: Setup

### Create Feishu App (if needed)

If the user doesn't have a Feishu app:

> I need you to create a Feishu self-built application:
>
> 1. Go to [Feishu Open Platform](https://open.feishu.cn/app) and log in
> 2. Click "Create Custom App"
> 3. Fill in app name and description
> 4. After creation, go to "Credentials & Basic Info":
>    - Copy **App ID** and **App Secret**
> 5. Go to "Add Abilities" → Enable "Bot"
> 6. Go to "Event Subscriptions":
>    - If WebSocket mode: Enable "Use long connection to receive events"
>    - If Webhook mode: Set the Request URL to your callback endpoint
>    - Subscribe to event: `im.message.receive_v1` (Receive messages)
> 7. Go to "Permissions & Scopes" → Add:
>    - `im:message` — Send messages
>    - `im:message.receive` — Receive messages
>    - `im:resource` — Access message resources (images, files)
>    - `contact:user.base:readonly` — Read user basic info (for sender names)
> 8. Click "Create Version" and submit for approval (or self-approve for internal apps)

Wait for the user to provide App ID and App Secret.

### Encryption key (optional)

> If you set up event encryption:
> - Go to "Event Subscriptions" → "Encryption Strategy"
> - Copy the **Encrypt Key** and **Verification Token**
> - These add an extra security layer for webhook mode

## Phase 4: Configure

Store the Feishu configuration:

```typescript
const feishuConfig = {
  appId: '<user-provided>',
  appSecret: '<user-provided>',
  encryptKey: '<optional>',
  verificationToken: '<optional>',
  connectionMode: 'websocket', // or 'webhook'
  dmPolicy: 'respond',  // 'respond' | 'ignore'
  groupPolicy: 'mention-only', // 'all' | 'mention-only' | 'ignore'
  requireMention: true,
};

setSetting('channel:feishu:config', JSON.stringify(feishuConfig));
```

### Policy configuration

Explain to the user:
- **dmPolicy**: How to handle direct messages to the bot
  - `respond` — Always respond to DMs
  - `ignore` — Ignore all DMs
- **groupPolicy**: How to handle group messages
  - `all` — Respond to every group message
  - `mention-only` — Only respond when @mentioned (recommended)
  - `ignore` — Don't respond in groups
- **requireMention**: If true, bot only responds to messages that @mention it in groups

## Phase 5: Verify

### Test the connection

After configuration, restart ClawDesktop2.

```typescript
// The probeFeishu function tests the connection
const { probeFeishu } = await import('./feishu/index.js');
const result = await probeFeishu();
```

> 1. Restart ClawDesktop2
> 2. Go to Settings → Channels — Feishu should show as "connected"
> 3. Open Feishu and find the bot (search by bot name)
> 4. Send a direct message to the bot
> 5. The bot should respond within a few seconds

### Send a test message

> In a Feishu group where the bot is added:
> 1. @mention the bot followed by a test message
> 2. Verify the bot responds
> 3. Check that the response appears in ClawDesktop2's chat history

### Troubleshooting

**Bot not appearing in search**
- Ensure the app version has been published/approved
- Check that "Bot" ability is enabled
- For internal apps: self-approve the version

**Bot not receiving messages**
- Verify `im.message.receive_v1` event is subscribed
- Check that the bot has `im:message.receive` permission
- For WebSocket: ensure "Use long connection" is enabled
- For Webhook: verify the callback URL is accessible

**IP whitelist errors**
- Go to "Security Settings" on open.feishu.cn
- Add your server's IP to the whitelist
- Or disable IP whitelist for development

**Permission scope issues**
- Go to "Permissions & Scopes"
- Ensure all required scopes are added AND approved
- Create a new app version after changing scopes

## After Setup

To reconfigure Feishu:
1. Update config via `setSetting('channel:feishu:config', ...)`
2. Restart ClawDesktop2

To switch from full Feishu to lite version:
1. First uninstall this skill from `.clawdesktop/state.yaml`
2. Then apply `/add-feishu2`

## Removal

1. Remove feishu config: `setSetting('channel:feishu:config', '')`
2. Revert `registration.ts` changes (restore from `.clawdesktop/backup/` or git)
3. Remove `feishu` from `.clawdesktop/state.yaml` applied_skills
4. Restart ClawDesktop2
