"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import {
  ArrowLeft,
  Loader2,
  Check,
  AlertCircle,
  ArrowDownRight,
  ArrowUpLeft,
  Phone,
  Zap,
  Building2,
  TrendingDown,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { supabase } from "@/lib/supabase/client";

// ---------------------------------------------------------------------------
// Config — plain-language descriptions for each transaction type
// ---------------------------------------------------------------------------

const TYPE_META: Record<string, { Icon: React.ElementType; color: string; desc: string }> = {
  "Cash In": {
    Icon: ArrowDownRight,
    color: "#10B981",
    desc: "Customer sends GCash to you, you give them cash",
  },
  "Cash Out": {
    Icon: ArrowUpLeft,
    color: "#EF4444",
    desc: "Customer gives you cash, you send them GCash",
  },
  "Telco Load": {
    Icon: Phone,
    color: "#8B5CF6",
    desc: "You load airtime for customer, they pay cash",
  },
  "Bills Payment": {
    Icon: Zap,
    color: "#F59E0B",
    desc: "You pay a bill via GCash, customer pays cash",
  },
  "Bank Transfer": {
    Icon: Building2,
    color: "#3B82F6",
    desc: "You transfer GCash to a bank, customer pays cash",
  },
  "Profit Remittance": {
    Icon: TrendingDown,
    color: "#6B7280",
    desc: "Cash leaves register (remit profit to owner)",
  },
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Rule {
  id: string;
  transaction_type: string;
  platform: string;
  profit_rate: number | null;
  profit_minimum: number | null;
  is_active: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function RulesSettingsPage() {
  const { operatorId, loading: authLoading } = useAuthGuard();

  const [rules, setRules] = useState<Rule[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  // Editing
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRate, setEditRate] = useState("");
  const [editMin, setEditMin] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successId, setSuccessId] = useState<string | null>(null);

  useEffect(() => {
    if (!operatorId) return;
    const opId = operatorId;
    async function fetch() {
      const { data } = await supabase
        .from("transaction_rules")
        .select("id, transaction_type, platform, profit_rate, profit_minimum, is_active")
        .eq("operator_id", opId)
        .order("transaction_type");
      if (data) setRules(data);
      setDataLoading(false);
    }
    fetch();
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
      prev.map((r) => (r.id === ruleId ? { ...r, profit_rate: rate, profit_minimum: min } : r))
    );
    setEditingId(null);
    setSuccessId(ruleId);
    setTimeout(() => setSuccessId(null), 2000);
  }

  async function toggleActive(rule: Rule) {
    const newVal = !rule.is_active;
    const { error: err } = await supabase
      .from("transaction_rules")
      .update({ is_active: newVal })
      .eq("id", rule.id);

    if (!err) {
      setRules((prev) =>
        prev.map((r) => (r.id === rule.id ? { ...r, is_active: newVal } : r))
      );
    }
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
      {/* Header */}
      <header className="px-5 pt-14 pb-4 flex items-center gap-3">
        <Link
          href="/settings"
          className="w-9 h-9 rounded-full bg-white/[0.07] flex items-center justify-center flex-shrink-0"
        >
          <ArrowLeft className="w-4 h-4 text-muted-foreground" />
        </Link>
        <div>
          <h1 className="text-base font-semibold">Profit Settings</h1>
          <p className="text-xs text-muted-foreground">How your earnings are calculated</p>
        </div>
      </header>

      {/* Rules List */}
      <section className="px-5 flex-1 space-y-3 pb-10">
        {rules.map((rule) => {
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
                  ? "bg-white/[0.04] border-white/[0.06]"
                  : "bg-white/[0.02] border-white/[0.03] opacity-50",
              ].join(" ")}
            >
              {/* Rule header */}
              <div className="px-4 py-3.5 flex items-start gap-3">
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5"
                  style={{ backgroundColor: meta.color + "18" }}
                >
                  <Icon className="w-4 h-4" style={{ color: meta.color }} />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <p className="text-sm font-semibold">{rule.transaction_type}</p>

                    <div className="flex items-center gap-2">
                      {justSaved && (
                        <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-medium">
                          <Check className="w-3 h-3" /> Saved
                        </span>
                      )}

                      {/* Active toggle */}
                      <button
                        onClick={() => toggleActive(rule)}
                        className={[
                          "relative w-9 h-5 rounded-full transition-colors",
                          rule.is_active ? "bg-emerald-500" : "bg-white/[0.15]",
                        ].join(" ")}
                      >
                        <span
                          className={[
                            "absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform",
                            rule.is_active ? "left-[18px]" : "left-0.5",
                          ].join(" ")}
                        />
                      </button>
                    </div>
                  </div>

                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    {meta.desc}
                  </p>

                  {/* Profit display — skip for Profit Remittance (no profit) */}
                  {!isProfitRemittance && !isEditing && (
                    <div className="flex items-center gap-3 mt-2.5">
                      <div className="bg-white/[0.06] rounded-lg px-2.5 py-1.5">
                        <p className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">Rate</p>
                        <p className="text-sm font-semibold tabular-nums">
                          {rule.profit_rate !== null ? `${rule.profit_rate}%` : "—"}
                        </p>
                      </div>
                      <div className="bg-white/[0.06] rounded-lg px-2.5 py-1.5">
                        <p className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">Min</p>
                        <p className="text-sm font-semibold tabular-nums">
                          {rule.profit_minimum !== null ? `₱${rule.profit_minimum}` : "—"}
                        </p>
                      </div>
                      <button
                        onClick={() => startEdit(rule)}
                        className="ml-auto text-[11px] text-emerald-400 font-medium"
                      >
                        Edit →
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Edit form */}
              {isEditing && (
                <div className="px-4 pb-4 pt-1 space-y-3 border-t border-white/[0.05] mx-4">
                  <div className="grid grid-cols-2 gap-3 pt-3">
                    <div className="space-y-1.5">
                      <Label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                        Rate (%)
                      </Label>
                      <Input
                        type="number"
                        inputMode="decimal"
                        value={editRate}
                        onChange={(e) => setEditRate(e.target.value)}
                        placeholder="e.g. 2"
                        autoFocus
                        className="bg-white/[0.07] border-white/[0.1] h-10 rounded-xl text-sm tabular-nums"
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
                        onChange={(e) => setEditMin(e.target.value)}
                        placeholder="e.g. 5"
                        className="bg-white/[0.07] border-white/[0.1] h-10 rounded-xl text-sm tabular-nums"
                      />
                    </div>
                  </div>

                  <p className="text-[10px] text-muted-foreground/60 leading-relaxed">
                    Your profit = max(amount × rate ÷ 100, minimum)
                  </p>

                  {error && (
                    <div className="flex items-center gap-2 text-xs text-red-400">
                      <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                      {error}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={() => saveRule(rule.id)}
                      disabled={saving}
                      className="flex-1 flex items-center justify-center gap-1.5 bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors"
                    >
                      {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                      Save
                    </button>
                    <button
                      onClick={cancelEdit}
                      className="px-4 py-2.5 bg-white/[0.07] text-muted-foreground font-medium rounded-xl text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        <p className="text-[11px] text-muted-foreground/50 text-center pt-4 leading-relaxed">
          These rules control how profit is calculated when you save a transaction.
          Disabled rules won&apos;t apply any profit.
        </p>
      </section>
    </div>
  );
}
