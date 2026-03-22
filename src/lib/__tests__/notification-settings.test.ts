import { describe, expect, it } from "vitest";
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  hasEnabledTelegramNotification,
  mergeNotificationSettings,
  parseNotificationSettings,
} from "../notification-settings";

describe("notification settings helpers", () => {
  it("parses nested telegram settings", () => {
    expect(
      parseNotificationSettings({
        notifications: {
          telegram: {
            processed: true,
            processing_error: false,
          },
        },
      })
    ).toEqual({
      telegram: {
        processed: true,
        processing_error: false,
      },
    });
  });

  it("keeps compatibility with legacy telegram_enabled", () => {
    expect(parseNotificationSettings({ telegram_enabled: true })).toEqual({
      telegram: {
        processed: true,
        processing_error: false,
      },
    });
  });

  it("merges nested settings without clobbering unrelated keys", () => {
    const merged = mergeNotificationSettings(
      { timezone: "Asia/Manila", notifications: { push: { processed: true } } },
      {
        telegram: {
          processed: true,
          processing_error: true,
        },
      }
    );

    expect(merged).toEqual({
      timezone: "Asia/Manila",
      notifications: {
        push: { processed: true },
        telegram: {
          processed: true,
          processing_error: true,
        },
      },
    });
  });

  it("detects whether any telegram notification is enabled", () => {
    expect(hasEnabledTelegramNotification(DEFAULT_NOTIFICATION_SETTINGS)).toBe(false);
    expect(
      hasEnabledTelegramNotification({
        telegram: {
          processed: false,
          processing_error: true,
        },
      })
    ).toBe(true);
  });
});

