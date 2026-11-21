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
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";

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

/**
 * A row of gocash.fee_rules currently in force (effective_to IS NULL).
 *
 * Replaces transaction_rules, which 20260924000006 drops. That table carried
 * both pricing AND the three delta_* multipliers that decided which direction
 * money moved — and operator-editable direction is why four of six transaction
 * types were silently destroying money. Direction now lives in
 * supabase/functions/_core/postings.ts. This screen is pricing only.
 */
interface Rule {
  id: string;
  transaction_type: string;
  platform: string;
  /** Basis points: 200 = 2.00%. Exact integer, unlike the old NUMERIC percent. */
  rate_bps: number;
  /** Centavos: 500 = PHP 5.00. */
  minimum_minor: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function RulesSettingsPage() {
  const { operatorId, loading: authLoading } = useAuthGuard({ ownerOnly: true });

  const [rules, setRules] = useState<Rule[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
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
      // effective_to IS NULL is the rule in force now. Closed periods are kept
      // so an amended transaction reprices at the rate that applied on its own
      // date rather than today's.
      const { data } = await supabase
        .from("fee_rules")
        .select("id, transaction_type, platform, rate_bps, minimum_minor")
        .eq("operator_id", opId)
        .is("effective_to", null)
        .order("transaction_type");
      if (data) setRules(data as Rule[]);
      setDataLoading(false);
    }
    fetch();
  }, [operatorId, refreshKey]);

  function startEdit(rule: Rule) {
    setEditingId(rule.id);
    setEditRate((rule.rate_bps / 100).toString());
    setEditMin((rule.minimum_minor / 100).toString());
    setError(null);
    setSuccessId(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setError(null);
  }

  async function saveRule(rule: Rule) {
    setSaving(true);
    setError(null);

    const ratePct = editRate.trim() === "" ? 0 : parseFloat(editRate);
    const minPeso = editMin.trim() === "" ? 0 : parseFloat(editMin);

    if (isNaN(ratePct) || ratePct < 0 || ratePct > 100) {
      setError("Rate must be between 0 and 100");
      setSaving(false);
      return;
    }
    if (isNaN(minPeso) || minPeso < 0) {
      setError("Minimum must be 0 or more");
      setSaving(false);
      return;
    }

    // Not an UPDATE. A price change closes the current period and opens a new
    // one so history stays intact, and doing that in two client statements
    // would leave a window where the no-overlap constraint is violated or no
    // rule is in force. set_fee_rule() does both atomically and checks that the
    // caller owns the operator.
    const { error: rpcError } = await supabase.rpc("set_fee_rule", {
      p_operator_id: operatorId!,
      p_transaction_type: rule.transaction_type,
      p_platform: rule.platform,
      p_rate_bps: Math.round(ratePct * 100),
      p_minimum_minor: Math.round(minPeso * 100),
      p_rounding:
        rule.transaction_type === "Cash In" || rule.transaction_type === "Cash Out"
          ? "ceil_unit"
          : "nearest_minor",
    });

    setSaving(false);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    // Refetch rather than patching state: set_fee_rule returns a NEW row id,
    // because the edited rule is a new period rather than a mutated row.
    setEditingId(null);
    setSuccessId(rule.id);
    setRefreshKey((k) => k + 1);
    setTimeout(() => setSuccessId(null), 2000);
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
        title="Profit settings"
        back="/settings"
        info={<>
          <p>Your fee on a transaction is the amount times the rate, and never less than the minimum.</p>
          <p>A rule that is switched off earns nothing.</p>
        </>}
      />

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
                // fee_rules has no is_active column, and it does not need one:
                // a rule that earns nothing is a rate of 0 with a minimum of 0,
                // which is exactly what a NULL rate meant before. Dimming the
                // card conveys that without a second way to express it.
                rule.rate_bps === 0 && rule.minimum_minor === 0
                  ? "bg-muted/60 border-border opacity-50"
                  : "bg-muted/60 border-border",
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
                        <span className="flex items-center gap-1 text-xs text-primary font-medium">
                          <Check className="w-3 h-3" /> Saved
                        </span>
                      )}

                      {/* The active toggle is gone. It set
                          transaction_rules.is_active, and fee_rules has no
                          equivalent — turning a price "off" is setting it to
                          zero, edited in the same place as any other change,
                          rather than a separate switch that could disagree with
                          the numbers beside it. */}
                    </div>
                  </div>

                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {meta.desc}
                  </p>

                  {/* Profit display — skip for Profit Remittance (no profit) */}
                  {!isProfitRemittance && !isEditing && (
                    <div className="flex items-center gap-3 mt-2.5">
                      <div className="bg-muted rounded-lg px-2.5 py-1.5">
                        <p className="text-xs text-muted-foreground/70 uppercase tracking-wider">Rate</p>
                        <p className="text-sm font-semibold tabular-nums">
                          {rule.rate_bps > 0 ? `${rule.rate_bps / 100}%` : "—"}
                        </p>
                      </div>
                      <div className="bg-muted rounded-lg px-2.5 py-1.5">
                        <p className="text-xs text-muted-foreground/70 uppercase tracking-wider">Min</p>
                        <p className="text-sm font-semibold tabular-nums">
                          {rule.minimum_minor > 0 ? `₱${(rule.minimum_minor / 100).toFixed(2)}` : "—"}
                        </p>
                      </div>
                      <button
                        onClick={() => startEdit(rule)}
                        className="ml-auto text-xs text-primary font-medium"
                      >
                        Edit →
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Edit form */}
              {isEditing && (
                <div className="px-4 pb-4 pt-1 space-y-3 border-t border-border mx-4">
                  <div className="grid grid-cols-2 gap-3 pt-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                        Rate (%)
                      </Label>
                      <Input
                        type="number"
                        inputMode="decimal"
                        value={editRate}
                        onChange={(e) => setEditRate(e.target.value)}
                        placeholder="e.g. 2"
                        autoFocus
                        className="bg-muted border-border h-10 rounded-xl text-sm tabular-nums"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                        Min (₱)
                      </Label>
                      <Input
                        type="number"
                        inputMode="decimal"
                        value={editMin}
                        onChange={(e) => setEditMin(e.target.value)}
                        placeholder="e.g. 5"
                        className="bg-muted border-border h-10 rounded-xl text-sm tabular-nums"
                      />
                    </div>
                  </div>

                  <p className="text-xs text-muted-foreground/60 leading-relaxed">
                    Your profit = max(amount × rate ÷ 100, minimum)
                  </p>

                  {error && (
                    <div className="flex items-center gap-2 text-xs text-destructive">
                      <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                      {error}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={() => saveRule(rule)}
                      disabled={saving}
                      className="flex-1 flex items-center justify-center gap-1.5 bg-primary hover:bg-primary/90 active:bg-primary/80 disabled:opacity-50 text-primary-foreground font-semibold py-2.5 rounded-xl text-sm transition-colors"
                    >
                      {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                      Save
                    </button>
                    <button
                      onClick={cancelEdit}
                      className="px-4 py-2.5 bg-muted text-muted-foreground font-medium rounded-xl text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}

      </section>
    </AppShell>
  );
}
