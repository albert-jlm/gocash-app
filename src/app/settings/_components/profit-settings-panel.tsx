"use client";

import { useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowDownRight,
  ArrowUpLeft,
  Building2,
  Check,
  Loader2,
  Phone,
  TrendingDown,
  Zap,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { sortPlatformNames } from "@/lib/platforms";
import { supabase } from "@/lib/supabase/client";

const TYPE_META: Record<string, { Icon: React.ElementType; color: string; desc: string }> = {
  "Cash In": {
    Icon: ArrowDownRight,
    color: "#10B981",
    desc: "Customer sends wallet funds to you and you release cash.",
  },
  "Cash Out": {
    Icon: ArrowUpLeft,
    color: "#EF4444",
    desc: "Customer gives cash and you send wallet funds.",
  },
  "Telco Load": {
    Icon: Phone,
    color: "#8B5CF6",
    desc: "You sell prepaid load and collect cash.",
  },
  "Bills Payment": {
    Icon: Zap,
    color: "#F59E0B",
    desc: "You pay a bill digitally and collect cash.",
  },
  "Bank Transfer": {
    Icon: Building2,
    color: "#3B82F6",
    desc: "You transfer funds to a bank and collect cash.",
  },
  "Profit Remittance": {
    Icon: TrendingDown,
    color: "#6B7280",
    desc: "Cash leaves the register for remittance.",
  },
};

interface Rule {
  id: string;
  transaction_type: string;
  platform: string;
  profit_rate: number | null;
  profit_minimum: number | null;
  is_active: boolean;
}

const TYPE_ORDER = new Map(
  [
    "Cash In",
    "Cash Out",
    "Telco Load",
    "Bills Payment",
    "Bank Transfer",
    "Profit Remittance",
  ].map((type, index) => [type, index])
);

export function ProfitSettingsPanel({ operatorId }: { operatorId: string }) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [platformNames, setPlatformNames] = useState<string[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRate, setEditRate] = useState("");
  const [editMin, setEditMin] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successId, setSuccessId] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function fetchRules() {
      const [rulesRes, platformsRes] = await Promise.all([
        supabase
          .from("transaction_rules")
          .select("id, transaction_type, platform, profit_rate, profit_minimum, is_active")
          .eq("operator_id", operatorId)
          .order("transaction_type"),
        supabase
          .from("operator_platforms")
          .select("name")
          .eq("operator_id", operatorId)
          .eq("is_active", true),
      ]);

      if (!isMounted) return;

      const platformNames = sortPlatformNames((platformsRes.data ?? []).map((row) => row.name));
      setPlatformNames(platformNames);

      if (rulesRes.data) {
        setRules(
          rulesRes.data.filter(
            (rule) => rule.platform === "all" || platformNames.includes(rule.platform)
          )
        );
      }

      setDataLoading(false);
    }

    void fetchRules();

    return () => {
      isMounted = false;
    };
  }, [operatorId]);

  function startEdit(rule: Rule) {
    setEditingId(rule.id);
    setEditRate(rule.profit_rate?.toString() ?? "");
    setEditMin(rule.profit_minimum?.toString() ?? "");
    setError(null);
    setSuccessId(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setError(null);
  }

  async function saveRule(ruleId: string) {
    setSaving(true);
    setError(null);

    const rate = editRate.trim() === "" ? null : parseFloat(editRate);
    const min = editMin.trim() === "" ? null : parseFloat(editMin);

    if (rate !== null && (isNaN(rate) || rate < 0 || rate > 100)) {
      setError("Rate must be between 0 and 100");
      setSaving(false);
      return;
    }

    if (min !== null && (isNaN(min) || min < 0)) {
      setError("Minimum must be 0 or more");
      setSaving(false);
      return;
    }

    const { error: updateError } = await supabase
      .from("transaction_rules")
      .update({ profit_rate: rate, profit_minimum: min })
      .eq("id", ruleId);

    setSaving(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setRules((prev) =>
      prev.map((rule) => (
        rule.id === ruleId
          ? { ...rule, profit_rate: rate, profit_minimum: min }
          : rule
      ))
    );
    setEditingId(null);
    setSuccessId(ruleId);
    setTimeout(() => setSuccessId(null), 2000);
  }

  async function toggleActive(rule: Rule) {
    const newValue = !rule.is_active;
    const { error: updateError } = await supabase
      .from("transaction_rules")
      .update({ is_active: newValue })
      .eq("id", rule.id);

    if (!updateError) {
      setRules((prev) =>
        prev.map((entry) => (entry.id === rule.id ? { ...entry, is_active: newValue } : entry))
      );
    }
  }

  if (dataLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-emerald-400" />
      </div>
    );
  }

  const orderedGroupKeys = [
    ...platformNames.filter((platformName) =>
      rules.some((rule) => rule.platform === platformName)
    ),
    ...[...new Set(rules.map((rule) => rule.platform))]
      .filter((platform) => platform !== "all" && !platformNames.includes(platform))
      .sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" })),
    ...(rules.some((rule) => rule.platform === "all") ? ["all"] : []),
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold">Profit Settings</h2>
        <p className="text-xs text-muted-foreground">Control how earnings are calculated for each wallet.</p>
      </div>

      <div className="space-y-3">
        {orderedGroupKeys.map((groupKey) => {
          const groupedRules = rules
            .filter((rule) => rule.platform === groupKey)
            .sort(
              (a, b) =>
                (TYPE_ORDER.get(a.transaction_type) ?? Number.MAX_SAFE_INTEGER) -
                (TYPE_ORDER.get(b.transaction_type) ?? Number.MAX_SAFE_INTEGER)
            );

          return (
            <section
              key={groupKey}
              className="rounded-3xl border border-white/[0.06] bg-white/[0.03] p-3"
            >
              <div className="mb-3 rounded-2xl bg-white/[0.04] px-4 py-3">
                <p className="text-sm font-semibold">
                  {groupKey === "all" ? "Shared Defaults" : `${groupKey} Wallet`}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {groupKey === "all"
                    ? "Fallback rules that apply across platforms when needed."
                    : `Profit rules for transactions saved under ${groupKey}.`}
                </p>
              </div>

              <div className="space-y-3">
                {groupedRules.map((rule) => {
                  const meta = TYPE_META[rule.transaction_type] ?? {
                    Icon: ArrowDownRight,
                    color: "#6B7280",
                    desc: rule.transaction_type,
                  };
                  const Icon = meta.Icon;
                  const isEditing = editingId === rule.id;
                  const justSaved = successId === rule.id;
                  const isProfitRemittance = rule.transaction_type === "Profit Remittance";

                  return (
                    <div
                      key={rule.id}
                      className={[
                        "rounded-2xl border transition-colors",
                        rule.is_active
                          ? "border-white/[0.06] bg-white/[0.04]"
                          : "border-white/[0.03] bg-white/[0.02] opacity-50",
                      ].join(" ")}
                    >
                      <div className="flex items-start gap-3 px-4 py-3.5">
                        <div
                          className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl"
                          style={{ backgroundColor: `${meta.color}18` }}
                        >
                          <Icon className="h-4 w-4" style={{ color: meta.color }} />
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="mb-0.5 flex items-center justify-between">
                            <div>
                              <p className="text-sm font-semibold">{rule.transaction_type}</p>
                              <p className="text-[10px] uppercase tracking-widest text-muted-foreground/70">
                                {groupKey === "all" ? "Fallback rule" : `${groupKey} wallet`}
                              </p>
                            </div>

                            <div className="flex items-center gap-2">
                              {justSaved && (
                                <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-400">
                                  <Check className="h-3 w-3" /> Saved
                                </span>
                              )}

                              <button
                                onClick={() => toggleActive(rule)}
                                className={[
                                  "relative h-5 w-9 rounded-full transition-colors",
                                  rule.is_active ? "bg-emerald-500" : "bg-white/[0.15]",
                                ].join(" ")}
                              >
                                <span
                                  className={[
                                    "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                                    rule.is_active ? "left-[18px]" : "left-0.5",
                                  ].join(" ")}
                                />
                              </button>
                            </div>
                          </div>

                          <p className="text-[11px] leading-relaxed text-muted-foreground">{meta.desc}</p>

                          {!isProfitRemittance && !isEditing && (
                            <div className="mt-2.5 flex items-center gap-3">
                              <div className="rounded-lg bg-white/[0.06] px-2.5 py-1.5">
                                <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
                                  Rate
                                </p>
                                <p className="text-sm font-semibold tabular-nums">
                                  {rule.profit_rate !== null ? `${rule.profit_rate}%` : "—"}
                                </p>
                              </div>
                              <div className="rounded-lg bg-white/[0.06] px-2.5 py-1.5">
                                <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
                                  Min
                                </p>
                                <p className="text-sm font-semibold tabular-nums">
                                  {rule.profit_minimum !== null ? `₱${rule.profit_minimum}` : "—"}
                                </p>
                              </div>
                              <button
                                onClick={() => startEdit(rule)}
                                className="ml-auto text-[11px] font-medium text-emerald-400"
                              >
                                Edit →
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      {isEditing && (
                        <div className="mx-4 space-y-3 border-t border-white/[0.05] px-0 pb-4 pt-1">
                          <div className="grid grid-cols-2 gap-3 pt-3">
                            <div className="space-y-1.5">
                              <Label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                                Rate (%)
                              </Label>
                              <Input
                                type="number"
                                inputMode="decimal"
                                value={editRate}
                                onChange={(event) => setEditRate(event.target.value)}
                                placeholder="e.g. 2"
                                autoFocus
                                className="h-10 rounded-xl border-white/[0.1] bg-white/[0.07] text-sm tabular-nums"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                                Min (₱)
                              </Label>
                              <Input
                                type="number"
                                inputMode="decimal"
                                value={editMin}
                                onChange={(event) => setEditMin(event.target.value)}
                                placeholder="e.g. 5"
                                className="h-10 rounded-xl border-white/[0.1] bg-white/[0.07] text-sm tabular-nums"
                              />
                            </div>
                          </div>

                          <p className="text-[10px] leading-relaxed text-muted-foreground/60">
                            Profit = max(amount × rate ÷ 100, minimum)
                          </p>

                          {error && (
                            <div className="flex items-center gap-2 text-xs text-red-400">
                              <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                              {error}
                            </div>
                          )}

                          <div className="flex gap-2">
                            <button
                              onClick={() => saveRule(rule.id)}
                              disabled={saving}
                              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-500 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-400 active:bg-emerald-600 disabled:opacity-50"
                            >
                              {saving ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Check className="h-4 w-4" />
                              )}
                              Save
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="rounded-xl bg-white/[0.07] px-4 py-2.5 text-sm font-medium text-muted-foreground"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      <p className="text-center text-[11px] leading-relaxed text-muted-foreground/50">
        Disabled rules will not apply profit. Rules are grouped by wallet so each platform is easier to
        review at a glance.
      </p>
    </div>
  );
}
