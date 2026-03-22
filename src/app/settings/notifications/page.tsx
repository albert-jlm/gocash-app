"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Loader2,
  Check,
  AlertCircle,
  Bell,
  MessageCircle,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { supabase } from "@/lib/supabase/client";
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  hasEnabledTelegramNotification,
  mergeNotificationSettings,
  parseNotificationSettings,
  type OperatorNotificationSettings,
} from "@/lib/notification-settings";

interface NotifSettings extends OperatorNotificationSettings {
  telegram_chat_id: string;
}

const DEFAULTS: NotifSettings = {
  ...DEFAULT_NOTIFICATION_SETTINGS,
  telegram_chat_id: "",
};

export default function NotificationsSettingsPage() {
  const { operatorId, loading: authLoading } = useAuthGuard();
  const searchParams = useSearchParams();

  const [settings, setSettings] = useState<NotifSettings>(DEFAULTS);
  const [dataLoading, setDataLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!operatorId) return;
    const opId = operatorId;
    async function fetch() {
      const { data } = await supabase
        .from("operators")
        .select("settings, telegram_chat_id")
        .eq("id", opId)
        .single();

      if (data) {
        const parsed = parseNotificationSettings(data.settings);
        setSettings({
          ...parsed,
          telegram_chat_id: (data.telegram_chat_id as string) ?? "",
        });
      }
      setDataLoading(false);
    }
    fetch();
  }, [operatorId]);

  async function save() {
    if (!operatorId) return;
    setSaving(true);
    setError(null);

    const { data: current } = await supabase
      .from("operators")
      .select("settings")
      .eq("id", operatorId)
      .single();

    const mergedSettings = mergeNotificationSettings(current?.settings, settings);

    const { error: updateErr } = await supabase
      .from("operators")
      .update({
        telegram_chat_id: settings.telegram_chat_id.trim() || null,
        settings: mergedSettings,
      })
      .eq("id", operatorId);

    setSaving(false);

    if (updateErr) {
      setError(updateErr.message);
      return;
    }

    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  if (authLoading || dataLoading) {
    return (
      <div className="flex min-h-screen bg-background items-center justify-center">
        <Loader2 className="w-6 h-6 text-emerald-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground max-w-[390px] mx-auto">
      <header className="px-5 pt-14 pb-4 flex items-center gap-3">
        <Link
          href={searchParams.get("from") ?? "/settings"}
          className="w-9 h-9 rounded-full bg-white/[0.07] flex items-center justify-center flex-shrink-0"
        >
          <ArrowLeft className="w-4 h-4 text-muted-foreground" />
        </Link>
        <div>
          <h1 className="text-base font-semibold">Notifications</h1>
          <p className="text-xs text-muted-foreground">Get alerts when transactions are processed</p>
        </div>
      </header>

      <section className="px-5 flex-1 space-y-4 pb-10">
        <div className="bg-white/[0.04] border border-white/[0.06] rounded-2xl overflow-hidden">
          <div className="px-4 py-3.5 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-500/10 flex items-center justify-center flex-shrink-0">
              <MessageCircle className="w-4 h-4 text-blue-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">Telegram preferences</p>
                {hasEnabledTelegramNotification(settings) && (
                  <span className="text-[10px] text-emerald-400 font-semibold uppercase tracking-widest">
                    Configured
                  </span>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed mt-0.5">
                Choose which Telegram alerts should be sent to your saved chat ID.
              </p>
            </div>
          </div>

          <div className="px-4 pb-4 pt-1 space-y-3 border-t border-white/[0.05] mx-4">
            {[
              {
                key: "processed" as const,
                label: "Transaction processed",
                description: "After AI finishes reading a screenshot and it needs review.",
              },
              {
                key: "processing_error" as const,
                label: "Processing error",
                description: "When the app cannot read a screenshot successfully.",
              },
            ].map((item) => (
              <div key={item.key} className="flex items-center justify-between gap-3 pt-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{item.label}</p>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    {item.description}
                  </p>
                </div>
                <button
                  onClick={() =>
                    setSettings((current) => ({
                      ...current,
                      telegram: {
                        ...current.telegram,
                        [item.key]: !current.telegram[item.key],
                      },
                    }))
                  }
                  className={[
                    "relative w-9 h-5 rounded-full transition-colors flex-shrink-0",
                    settings.telegram[item.key] ? "bg-emerald-500" : "bg-white/[0.15]",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform",
                      settings.telegram[item.key] ? "left-[18px]" : "left-0.5",
                    ].join(" ")}
                  />
                </button>
              </div>
            ))}

            <div className="space-y-1.5 pt-2">
              <Label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Telegram Chat ID
              </Label>
              <Input
                value={settings.telegram_chat_id}
                onChange={(e) =>
                  setSettings((current) => ({ ...current, telegram_chat_id: e.target.value }))
                }
                placeholder="e.g. 123456789"
                inputMode="numeric"
                className="bg-white/[0.07] border-white/[0.1] h-10 rounded-xl text-sm tabular-nums"
              />
            </div>
            <p className="text-[10px] text-muted-foreground/60 leading-relaxed">
              Telegram delivery works when a bot token is configured on the server. Push notifications are still deferred.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 bg-white/[0.04] border border-white/[0.06] rounded-2xl px-4 py-3.5 opacity-50">
          <div className="w-9 h-9 rounded-xl bg-white/[0.08] flex items-center justify-center flex-shrink-0">
            <Bell className="w-4 h-4 text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">Push Notifications</p>
            <p className="text-[11px] text-muted-foreground">Not included in this release</p>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-xs text-red-400">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            {error}
          </div>
        )}

        <button
          onClick={save}
          disabled={saving}
          className="w-full flex items-center justify-center gap-1.5 bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 disabled:opacity-50 text-white font-semibold py-3 rounded-xl text-sm transition-colors"
        >
          {saving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : saved ? (
            <Check className="w-4 h-4" />
          ) : null}
          {saved ? "Saved" : "Save Changes"}
        </button>

        <p className="text-[11px] text-muted-foreground/50 text-center pt-2 leading-relaxed">
          Transactions always save normally whether these preferences are filled in or not.
        </p>
      </section>
    </div>
  );
}
