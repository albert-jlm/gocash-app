import { describe, expect, it, vi } from "vitest";
import {
  buildProcessedTelegramMessage,
  buildProcessingErrorTelegramMessage,
  parseTelegramNotificationTarget,
  sendTelegramMessage,
} from "../../../supabase/functions/_shared/telegram";

describe("telegram notifications", () => {
  it("parses nested telegram preferences and chat id", () => {
    const target = parseTelegramNotificationTarget({
      telegram_chat_id: "123456789",
      settings: {
        notifications: {
          telegram: {
            processed: true,
            processing_error: false,
          },
        },
      },
    });

    expect(target.chatId).toBe("123456789");
    expect(target.isEnabledFor("processed")).toBe(true);
    expect(target.isEnabledFor("processing_error")).toBe(false);
  });

  it("keeps compatibility with legacy telegram_enabled", () => {
    const target = parseTelegramNotificationTarget({
      telegram_chat_id: "987654321",
      settings: {
        telegram_enabled: true,
      },
    });

    expect(target.isEnabledFor("processed")).toBe(true);
    expect(target.isEnabledFor("processing_error")).toBe(false);
  });

  it("builds a processed message with escaped user data", () => {
    const message = buildProcessedTelegramMessage({
      transactionId: "tx_123",
      platform: "GCash <Main>",
      transactionType: "Cash In",
      amount: 500,
      netProfit: 10,
      accountNumber: "0917<123>4567",
      referenceNumber: "ABC&123",
    });

    expect(message).toContain("<b>GoCash: transaction ready for review</b>");
    expect(message).toContain("Platform: GCash &lt;Main&gt;");
    expect(message).toContain("Account: 0917&lt;123&gt;4567");
    expect(message).toContain("Reference: ABC&amp;123");
  });

  it("builds a processing error message", () => {
    expect(
      buildProcessingErrorTelegramMessage({ reason: "Failed to store screenshot" })
    ).toContain("Reason: Failed to store screenshot");
  });

  it("posts to Telegram when token and chat id are present", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });

    await sendTelegramMessage({
      botToken: "bot-token",
      chatId: "123456789",
      text: "hello",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.telegram.org/botbot-token/sendMessage",
      expect.objectContaining({
        method: "POST",
      })
    );
  });

  it("skips sending when token or chat id is missing", async () => {
    const fetchImpl = vi.fn();

    await sendTelegramMessage({
      botToken: null,
      chatId: "123456789",
      text: "hello",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await sendTelegramMessage({
      botToken: "bot-token",
      chatId: null,
      text: "hello",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
