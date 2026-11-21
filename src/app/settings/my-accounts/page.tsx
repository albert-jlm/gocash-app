"use client";

/**
 * Settings → My numbers & accounts. Owner only.
 *
 * A receipt shows which way money moved, not why. Listing the shop's own
 * numbers and account numbers here lets the reader tell "I moved my own money
 * between wallets" from "I served a customer", and keeps the shop's own number
 * from ever being recorded as a customer's.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, AlertCircle, Check, Plus, Trash2, Smartphone, Landmark } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import {
  addOwnIdentifier, listOwnIdentifiers, removeOwnIdentifier,
  type OwnIdentifierRow, type WalletOption,
} from "@/lib/ledger";

/** 0917 123 4567, or an account number in groups of four. */
function pretty(row: OwnIdentifierRow): string {
  return row.kind === "mobile"
    ? row.value.replace(/^(\d{4})(\d{3})(\d{4})$/, "$1 $2 $3")
    : row.value.replace(/(\d{4})(?=\d)/g, "$1 ");
}

export default function MyAccountsPage() {
  const { loading: authLoading } = useAuthGuard({ ownerOnly: true });

  const [identifiers, setIdentifiers] = useState<OwnIdentifierRow[]>([]);
  const [wallets, setWallets] = useState<WalletOption[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  const [walletId, setWalletId] = useState("");
  const [kind, setKind] = useState<"mobile" | "account">("mobile");
  const [value, setValue] = useState("");
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;
    listOwnIdentifiers()
      .then((r) => {
        if (cancelled) return;
        setIdentifiers(r.identifiers);
        setWallets(r.wallets);
        if (r.wallets.length === 1) setWalletId(r.wallets[0].id);
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Could not load your numbers"); })
      .finally(() => { if (!cancelled) setDataLoading(false); });
    return () => { cancelled = true; };
  }, [authLoading]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (adding || !walletId || value.trim() === "") return;
    setAdding(true);
    setError(null);
    setNotice(null);
    try {
      const row = await addOwnIdentifier({ accountId: walletId, kind, value });
      setIdentifiers((prev) => [...prev, row]);
      setValue("");
      const wallet = wallets.find((w) => w.id === walletId)?.name ?? "that wallet";
      setNotice(`Added. Receipts to or from ${pretty(row)} are now read as your own ${wallet}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add that number");
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(row: OwnIdentifierRow) {
    setRemovingId(row.id);
    setError(null);
    setNotice(null);
    try {
      await removeOwnIdentifier(row.id);
      setIdentifiers((prev) => prev.filter((r) => r.id !== row.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove that number");
    } finally {
      setRemovingId(null);
    }
  }

  if (authLoading || dataLoading) {
    return (
      <AppShell active="settings">
        <div className="flex-1 grid place-items-center">
          <Loader2 className="late w-6 h-6 text-muted-foreground animate-spin" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell active="settings">
      <PageHeader
        title="My numbers & accounts"
        back="/settings"
        info={<>
          <p>Add the mobile number of each of your wallets, and the account number of any bank wallet.</p>
          <p>When a screenshot shows money going to or coming from one of these, it is recorded as <b>moving your own money</b>, with no fee earned. Your own numbers are never saved as a customer&apos;s.</p>
          <p>A bank account you don&apos;t track here isn&apos;t a wallet. Add it under <b>Settings → Platforms</b> first.</p>
        </>}
      />

      <section className="px-5 flex-1 space-y-4 pb-10">
        {error && (
          <div className="flex items-start gap-2.5 bg-destructive/10 border border-destructive/20 rounded-2xl px-4 py-3">
            <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
            <p className="text-[13px] text-destructive leading-relaxed">{error}</p>
          </div>
        )}
        {notice && (
          <div className="flex items-start gap-2.5 bg-primary/10 border border-primary/20 rounded-2xl px-4 py-3">
            <Check className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
            <p className="text-[13px] text-primary leading-relaxed">{notice}</p>
          </div>
        )}


        {wallets.map((w) => {
          const rows = identifiers.filter((r) => r.account_id === w.id);
          return (
            <div key={w.id} className="bg-muted rounded-2xl overflow-hidden">
              <p className="px-4 pt-3.5 pb-2 text-[15px] font-semibold">{w.name}</p>
              {rows.length === 0 ? (
                <p className="px-4 pb-3.5 text-[13px] text-muted-foreground">Nothing added yet.</p>
              ) : (
                <div className="divide-y divide-border">
                  {rows.map((r) => (
                    <div key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                      {r.kind === "mobile"
                        ? <Smartphone className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                        : <Landmark className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <p className="text-[15px] tabular-nums truncate">{pretty(r)}</p>
                        <p className="text-[13px] text-muted-foreground">
                          {r.kind === "mobile" ? "Mobile number" : "Account number"}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemove(r)}
                        disabled={removingId === r.id}
                        aria-label={`Remove ${pretty(r)}`}
                        className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center flex-shrink-0 disabled:opacity-50"
                      >
                        {removingId === r.id
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        <form onSubmit={handleAdd} className="bg-muted rounded-2xl p-4 space-y-3">
          <p className="label">Add one</p>

          <select
            aria-label="Which wallet"
            value={walletId}
            onChange={(e) => setWalletId(e.target.value)}
            className="w-full rounded-xl bg-muted px-4 py-3 text-[15px] appearance-none"
          >
            <option value="">Which wallet is it?</option>
            {wallets.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>

          <div className="grid grid-cols-2 gap-2">
            {(["mobile", "account"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={`rounded-xl py-2.5 text-[13px] font-medium ${
                  kind === k ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                }`}
              >
                {k === "mobile" ? "Mobile number" : "Account number"}
              </button>
            ))}
          </div>

          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={kind === "mobile" ? "09XX XXX XXXX" : "Account number, digits only"}
            className="w-full rounded-xl bg-muted px-4 py-3 text-[15px] tabular-nums"
          />

          <button
            type="submit"
            disabled={adding || !walletId || value.trim() === ""}
            className="btn btn-primary w-full"
          >
            {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Add
          </button>
        </form>

      </section>
    </AppShell>
  );
}
