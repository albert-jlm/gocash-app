"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
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
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NotifSettings {
  telegram_enabled: boolean;
  telegram_chat_id: string;
}

const DEFAULTS: NotifSettings = {
  telegram_enabled: false,
  telegram_chat_id: "",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function NotificationsSettingsPage() {
  const { operatorId, loading: authLoading } = useAuthGuard({ ownerOnly: true });

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
        const s = (data.settings ?? {}) as Record<string, unknown>;
        setSettings({
          telegram_enabled: Boolean(s.telegram_enabled),
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

    // Fetch current settings first, then merge — prevents clobbering unrelated keys
    const { data: current } = await supabase
      .from("operators")
      .select("settings")
      .eq("id", operatorId)
      .single();

    const existingSettings = (current?.settings ?? {}) as Record<string, unknown>;
    const mergedSettings = {
      ...existingSettings,
      telegram_enabled: settings.telegram_enabled,
    };

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
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <AppShell active="settings">
      {/* Header */}
      <PageHeader
        title="Notifications"
        back="/settings"
        info={<>
          <p>Optional. Your transactions are saved whether notifications are on or off.</p>
        </>}
      />

      <section className="px-5 flex-1 space-y-4 pb-10">
        {/* Telegram card */}
        <div className="bg-muted/60 border border-border rounded-2xl overflow-hidden">
          {/* Card header */}
          <div className="px-4 py-3.5 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
              <MessageCircle className="w-4 h-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">Telegram</p>
                <button
                  onClick={() =>
                    setSettings((s) => ({ ...s, telegram_enabled: !s.telegram_enabled }))
                  }
                  className={[
                    "relative w-9 h-5 rounded-full transition-colors",
                    settings.telegram_enabled ? "bg-primary" : "bg-foreground/10",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "absolute top-0.5 w-4 h-4 rounded-full bg-foreground shadow-sm transition-transform",
                      settings.telegram_enabled ? "left-[18px]" : "left-0.5",
                    ].join(" ")}
                  />
                </button>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">
                Receive a message when a transaction is processed by AI
              </p>
            </div>
          </div>

          {/* Chat ID input — shown when enabled */}
          {settings.telegram_enabled && (
            <div className="px-4 pb-4 pt-1 space-y-3 border-t border-border mx-4">
              <div className="space-y-1.5 pt-3">
                <Label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Telegram Chat ID
                </Label>
                <Input
                  value={settings.telegram_chat_id}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, telegram_chat_id: e.target.value }))
                  }
                  placeholder="e.g. 123456789"
                  inputMode="numeric"
                  className="bg-muted border-border h-10 rounded-xl text-sm tabular-nums"
                />
              </div>
              <p className="text-xs text-muted-foreground/60 leading-relaxed">
                Send /start to @GoCashTrackerBot on Telegram, then paste the Chat ID it gives you.
              </p>
            </div>
          )}
        </div>

        {/* Future — push notifications placeholder */}
        <div className="flex items-center gap-3 bg-muted/60 border border-border rounded-2xl px-4 py-3.5 opacity-50">
          <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center flex-shrink-0">
            <Bell className="w-4 h-4 text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">Push Notifications</p>
            <p className="text-xs text-muted-foreground">Coming soon</p>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 text-xs text-destructive">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* Save button */}
        <button
          onClick={save}
          disabled={saving}
          className="w-full flex items-center justify-center gap-1.5 bg-primary hover:bg-primary/90 active:bg-primary/80 disabled:opacity-50 text-primary-foreground font-semibold py-3 rounded-xl text-sm transition-colors"
        >
          {saving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : saved ? (
            <Check className="w-4 h-4" />
          ) : null}
          {saved ? "Saved" : "Save Changes"}
        </button>

      </section>
    </AppShell>
  );
}
