# registration.ts — Feishu-Lite Addition Intent

## What Changed

1. **Added `createFeishuLiteChannelInstance()`**: New function that creates a `ChannelInstance` using the `FeishuLiteChannel` class from `feishu-lite/`. Uses dynamic import to avoid bundling issues.

2. **Modified `registerChannels()`**: Added logic to check for `channel:feishu-lite:config` first. If present, registers feishu-lite instead of the full feishu channel. This ensures only one Feishu variant is active.

3. **Added `FeishuLiteConfig` interface**: Local type for the lite configuration (appId + appSecret only).

## Invariants

- QQ channel registration is UNCHANGED
- The original `createFeishuChannelInstance()` is preserved as fallback
- Only ONE feishu variant is registered at a time (lite takes priority if configured)
- `registerChannels()` export signature unchanged
- Dynamic imports used for `feishu-lite/index.js` to keep it lazy-loaded

## Merge Guidance

If conflicts arise in `registerChannels()`, the key change is replacing the unconditional `createFeishuChannelInstance()` call with a conditional that checks for feishu-lite config first.
