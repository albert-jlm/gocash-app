export interface TelegramNotificationSettings {
  processed: boolean;
  processing_error: boolean;
}

export interface OperatorNotificationSettings {
  telegram: TelegramNotificationSettings;
}

export const DEFAULT_NOTIFICATION_SETTINGS: OperatorNotificationSettings = {
  telegram: {
    processed: false,
    processing_error: false,
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function parseNotificationSettings(value: unknown): OperatorNotificationSettings {
  const root = isRecord(value) ? value : {};
  const legacyEnabled = readBoolean(root.telegram_enabled, false);
  const notifications = isRecord(root.notifications) ? root.notifications : {};
  const telegram = isRecord(notifications.telegram) ? notifications.telegram : {};

  return {
    telegram: {
      processed: readBoolean(telegram.processed, legacyEnabled),
      processing_error: readBoolean(telegram.processing_error, false),
    },
  };
}

export function mergeNotificationSettings(
  existing: unknown,
  next: OperatorNotificationSettings
): Record<string, unknown> {
  const root = isRecord(existing) ? { ...existing } : {};
  const notifications = isRecord(root.notifications) ? { ...root.notifications } : {};

  notifications.telegram = {
    processed: next.telegram.processed,
    processing_error: next.telegram.processing_error,
  };

  root.notifications = notifications;
  delete root.telegram_enabled;

  return root;
}

export function hasEnabledTelegramNotification(settings: OperatorNotificationSettings): boolean {
  return settings.telegram.processed || settings.telegram.processing_error;
}

