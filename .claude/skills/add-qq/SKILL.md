---
name: add-qq
description: Configure QQ Bot channel for ClawDesktop2. The QQ channel code is already fully implemented — this skill walks through setup and activation.
---

# Add QQ Channel

This skill configures the existing QQ Bot integration in ClawDesktop2. No code changes are needed — QQ support is already built in (`electron/channels/qq/`). This is a pure configuration wizard.

## Phase 1: Pre-flight

### Check if already configured

Read the current QQ configuration:

```typescript
const config = getSetting('channel:qq:config');
```

If config exists and contains valid `appId` and `clientSecret`, inform the user that QQ is already configured. Ask if they want to reconfigure.

### Ask the user

AskUserQuestion: Do you have a QQ Bot already created on q.qq.com?
- **Yes** — I have appId and clientSecret ready
- **No** — I need to create one first

AskUserQuestion: Which message intents do you need?
- **GUILD_MESSAGES** — Bot messages in guild channels (no audit required)
- **GROUP_AND_C2C** — Group and private messages (requires intent approval)
- **DIRECT_MESSAGE** — Direct messages in guild context
- **All of the above** — Full coverage

AskUserQuestion: Environment mode?
- **Sandbox** — Testing with test guild (recommended for initial setup)
- **Production** — Live deployment

## Phase 2: No Code Changes

This skill does not modify any source files. The QQ channel implementation is complete:

- `electron/channels/qq/channel.ts` — QQChannel class with WebSocket gateway
- `electron/channels/qq/auth.ts` — OAuth2 token management
- `electron/channels/qq/send.ts` — Message sending (text, markdown, rich text, media)
- `electron/channels/qq/media.ts` — Media upload support
- `electron/channels/qq/rich-text.ts` — Rich text message formatting
- `electron/channels/qq/gateway.ts` — WebSocket gateway connection
- `electron/channels/qq/types.ts` — Type definitions
- `electron/channels/qq/index.ts` — Module exports
- `electron/channels/registration.ts` — Already registers QQ channel

Skip `npx tsx scripts/apply-skill.ts` — there is nothing to apply.

## Phase 3: Setup

### Create QQ Bot (if needed)

If the user doesn't have a QQ Bot:

> I need you to create a QQ Bot:
>
> 1. Go to [QQ Open Platform](https://q.qq.com) and log in
> 2. Click "Create Application" → "Bot"
> 3. Fill in:
>    - Bot name
>    - Description
>    - Choose "Machine" as the type
> 4. After creation, go to "Development Settings":
>    - Copy **AppID** and **ClientSecret** (also called Token)
> 5. Go to "Subscribe to Intents":
>    - Enable the message intents you selected above
>    - Note: `GROUP_AND_C2C` requires Tencent's audit approval

Wait for the user to provide appId and clientSecret.

### Sandbox Setup (if sandbox mode)

> For sandbox testing:
>
> 1. In the QQ Open Platform, go to your bot's "Sandbox Configuration"
> 2. Create or select a test guild
> 3. Add your test accounts to the sandbox guild
> 4. The bot will only respond in sandbox guilds until you go to production

## Phase 4: Configure

Store the QQ configuration using IPC:

```typescript
const config = {
  appId: '<user-provided-app-id>',
  clientSecret: '<user-provided-client-secret>',
  sandbox: true, // or false for production
  intents: ['GUILD_MESSAGES'], // based on user selection
};

setSetting('channel:qq:config', JSON.stringify(config));
```

Verify that `electron/channels/registration.ts` reads this config:
- It calls `getSetting('channel:qq:config')` on startup
- Parses the JSON and creates a `QQChannel` instance if `appId` and `clientSecret` are present

## Phase 5: Verify

### Restart the application

The channel configuration is read during app initialization. The user must restart ClawDesktop2:

> Please restart ClawDesktop2 to activate the QQ channel.
> After restart, go to Settings → Channels — QQ should show as "connected".

### Test the connection

> 1. Open your QQ guild (sandbox guild if in sandbox mode)
> 2. Send a message in a text channel where the bot has access
> 3. The bot should appear in the channel members list
> 4. Send a test message — the bot should respond

### Check channel status via UI

In the ClawDesktop2 UI, navigate to the Channels page:
- QQ channel should show status: "connected"
- If it shows "disconnected" or "error", check the logs

### Troubleshooting

**Bot not responding**
1. Check appId and clientSecret are correct
2. Verify the bot has been added to the guild
3. Check that the required intents are enabled and approved
4. For `GROUP_AND_C2C`: ensure Tencent has approved the intent

**Token expired**
- QQ Bot tokens are managed by the OAuth2 flow automatically
- If issues persist, regenerate the clientSecret on q.qq.com and update the config

**Sandbox vs Production confusion**
- In sandbox mode, the bot ONLY works in the designated test guild
- Switch `sandbox: false` in config when ready for production
- Production requires Tencent's review of your bot application

**WebSocket connection failing**
- Check network connectivity
- Ensure no firewall blocks WebSocket connections to `wss://api.sgroup.qq.com`
- For sandbox: `wss://sandbox.api.sgroup.qq.com`

## After Setup

To change QQ configuration later:
1. Update via Settings → Channels → QQ in the UI, or
2. Use IPC: `setSetting('channel:qq:config', JSON.stringify(newConfig))`
3. Restart ClawDesktop2

To disable QQ channel:
1. Remove the config: `setSetting('channel:qq:config', '')`
2. Restart ClawDesktop2
