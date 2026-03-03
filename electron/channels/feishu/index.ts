import type { OpenClawPluginApi } from "./plugin-adapter.js";
import { emptyPluginConfigSchema } from "./plugin-adapter.js";
import { registerFeishuBitableTools } from "./bitable.js";
import { feishuPlugin } from "./channel.js";
import { registerFeishuDocTools } from "./docx.js";
import { registerFeishuDriveTools } from "./drive.js";
import { registerFeishuPermTools } from "./perm.js";
import { setFeishuRuntime } from "./runtime.js";
import { registerFeishuWikiTools } from "./wiki.js";

export { monitorFeishuProvider } from "./monitor.js";
export {
  sendMessageFeishu,
  sendCardFeishu,
  updateCardFeishu,
  editMessageFeishu,
  getMessageFeishu,
} from "./send.js";
export {
  uploadImageFeishu,
  uploadFileFeishu,
  sendImageFeishu,
  sendFileFeishu,
  sendMediaFeishu,
} from "./media.js";
export { probeFeishu } from "./probe.js";
export {
  addReactionFeishu,
  removeReactionFeishu,
  listReactionsFeishu,
  FeishuEmoji,
} from "./reactions.js";
export {
  extractMentionTargets,
  extractMessageBody,
  isMentionForwardRequest,
  formatMentionForText,
  formatMentionForCard,
  formatMentionAllForText,
  formatMentionAllForCard,
  buildMentionedMessage,
  buildMentionedCardContent,
  type MentionTarget,
} from "./mention.js";
export { feishuPlugin } from "./channel.js";

const plugin = {
  id: "feishu",
  name: "Feishu",
  description: "Feishu/Lark channel plugin",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setFeishuRuntime(api.runtime);
    // Type variance: feishuPlugin is ChannelPlugin<ResolvedFeishuAccount>,
    // registerChannel expects ChannelPlugin<never> for contravariance
    api.registerChannel({ plugin: feishuPlugin as never });
    registerFeishuDocTools(api);
    registerFeishuWikiTools(api);
    registerFeishuDriveTools(api);
    registerFeishuPermTools(api);
    registerFeishuBitableTools(api);
  },
};

export default plugin;
