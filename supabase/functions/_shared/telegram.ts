type NotificationEvent = "processed" | "processing_error";

interface TelegramNotificationSettings {
  processed: boolean;
  processing_error: boolean;
}

interface TelegramTargetSource {
  settings: unknown;
  telegram_chat_id: string | null;
}

interface ProcessedNotificationPayload {
  transactionId: string;
  platform: string;
  transactionType: string;
  amount: number;
  netProfit: number;
  accountNumber: string | null;
  referenceNumber: string | null;
}

interface ProcessingErrorNotificationPayload {
  reason: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function escapeTelegramText(value: string): string {
  return value.replace(/[&<>]/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      default:
        return char;
    }
  });
}

export function parseTelegramNotificationTarget(source: TelegramTargetSource) {
  const root = isRecord(source.settings) ? source.settings : {};
  const legacyEnabled = readBoolean(root.telegram_enabled, false);
  const notifications = isRecord(root.notifications) ? root.notifications : {};
  const telegram = isRecord(notifications.telegram) ? notifications.telegram : {};
  const chatId = source.telegram_chat_id?.trim() || null;

  const settings: TelegramNotificationSettings = {
    processed: readBoolean(telegram.processed, legacyEnabled),
    processing_error: readBoolean(telegram.processing_error, false),
  };

  return {
    chatId,
    settings,
    isEnabledFor(event: NotificationEvent) {
      return Boolean(chatId) && settings[event];
    },
  };
}

export function buildProcessedTelegramMessage(
  payload: ProcessedNotificationPayload
): string {
  const lines = [
    "<b>GoCash: transaction ready for review</b>",
    `Type: ${escapeTelegramText(payload.transactionType)}`,
    `Platform: ${escapeTelegramText(payload.platform)}`,
    `Amount: PHP ${payload.amount.toFixed(2)}`,
    `Profit: PHP ${payload.netProfit.toFixed(2)}`,
  ];

  if (payload.accountNumber) {
    lines.push(`Account: ${escapeTelegramText(payload.accountNumber)}`);
  }

  if (payload.referenceNumber) {
    lines.push(`Reference: ${escapeTelegramText(payload.referenceNumber)}`);
  }

  lines.push(`Transaction ID: ${escapeTelegramText(payload.transactionId)}`);

  return lines.join("\n");
}

export function buildProcessingErrorTelegramMessage(
  payload: ProcessingErrorNotificationPayload
): string {
  return [
    "<b>GoCash: screenshot processing failed</b>",
    `Reason: ${escapeTelegramText(payload.reason)}`,
    "The screenshot was not saved for review. Please retry the upload.",
  ].join("\n");
}

export async function sendTelegramMessage(args: {
  botToken: string | null | undefined;
  chatId: string | null;
  text: string;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const { botToken, chatId, text, fetchImpl = fetch } = args;

  if (!botToken || !chatId) return;

  const response = await fetchImpl(
    `https://api.telegram.org/bot${botToken}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Telegram API request failed with status ${response.status}`);
  }
}
