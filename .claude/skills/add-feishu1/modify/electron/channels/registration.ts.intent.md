# registration.ts — Feishu Enhancement Intent

## What Changed

The `createFeishuChannelInstance()` function was enhanced from a placeholder to a fully functional bridge:

1. **Config reading**: Reads `channel:feishu:config` from SQLite settings on `start()`
2. **Dynamic import**: Uses `import('./feishu/index.js')` to load Feishu SDK functions
3. **Event bridging**: Connects `monitorFeishuProvider` callbacks to `ChannelManager.dispatchMessage()`
4. **Send support**: Implements `send()` using `sendMessageFeishu()` with chatId extraction
5. **State tracking**: Maps Feishu connection states to ChannelStatus enum

## Invariants

- QQ channel registration logic is UNCHANGED — do not modify it during merge
- The `registerChannels()` export signature and call pattern must remain identical
- `FeishuChannelConfig` interface is local to this file — not exported
- Dynamic imports (`await import(...)`) are used to avoid bundling Feishu SDK in the main bundle
- The `ChannelInstance` interface contract must be preserved: `start()`, `stop()`, `send()`

## Merge Guidance

If there are conflicts in `registerChannels()`, keep both the QQ and Feishu registration blocks. The function should register both channels sequentially.
