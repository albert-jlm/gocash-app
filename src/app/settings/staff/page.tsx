"use client";

/**
 * Settings → Staff. Owner only.
 *
 * Signups are closed, so this is how another person gets in: the owner adds
 * their email, and they sign in with a code sent to it. They record into this
 * shop's books with the staff role.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, AlertCircle, Check, UserPlus, Trash2, Crown, User } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { addStaff, listStaff, removeStaff, type StaffMember } from "@/lib/ledger";

export default function StaffSettingsPage() {
  const { loading: authLoading } = useAuthGuard({ ownerOnly: true });

  const [ownerEmail, setOwnerEmail] = useState<string | null>(null);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;
    listStaff()
      .then((r) => { if (!cancelled) { setOwnerEmail(r.ownerEmail); setStaff(r.staff); } })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Could not load staff"); })
      .finally(() => { if (!cancelled) setDataLoading(false); });
    return () => { cancelled = true; };
  }, [authLoading]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || adding) return;
    setAdding(true);
    setError(null);
    setNotice(null);
    try {
      const member = await addStaff(trimmed);
      setStaff((prev) => [...prev, member]);
      setEmail("");
      setNotice(`${member.email} can now sign in with that email. A code is sent to it each time.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add that person");
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(member: StaffMember) {
    setRemovingId(member.id);
    setError(null);
    setNotice(null);
    try {
      await removeStaff(member.id);
      setStaff((prev) => prev.filter((m) => m.id !== member.id));
      setNotice(`${member.email} no longer has access.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove that person");
    } finally {
      setRemovingId(null);
      setConfirmRemoveId(null);
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
    <AppShell active="settings">
      <header className="px-5 pt-14 lg:pt-10 pb-4 flex items-center gap-3">
        <Link
          href="/settings"
          className="w-9 h-9 rounded-full bg-white/[0.07] flex items-center justify-center flex-shrink-0"
        >
          <ArrowLeft className="w-4 h-4 text-muted-foreground" />
        </Link>
        <div>
          <h1 className="text-base font-semibold">Staff</h1>
          <p className="text-xs text-muted-foreground">Who else can record transactions</p>
        </div>
      </header>

      <section className="px-5 flex-1 space-y-4 pb-10">
        {error && (
          <div className="flex items-start gap-2.5 bg-red-500/10 border border-red-500/20 rounded-2xl px-4 py-3">
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-red-300 leading-relaxed">{error}</p>
          </div>
        )}
        {notice && (
          <div className="flex items-start gap-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl px-4 py-3">
            <Check className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-emerald-200 leading-relaxed">{notice}</p>
          </div>
        )}

        <div className="bg-white/[0.05] rounded-2xl overflow-hidden divide-y divide-white/[0.06]">
          <div className="flex items-center gap-3 px-4 py-3.5">
            <div className="w-9 h-9 rounded-xl bg-amber-500/15 flex items-center justify-center flex-shrink-0">
              <Crown className="w-4 h-4 text-amber-300" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{ownerEmail ?? "You"}</p>
              <p className="text-[11px] text-muted-foreground">Owner · you</p>
            </div>
          </div>

          {staff.map((m) => (
            <div key={m.id} className="px-4 py-3.5">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-white/[0.07] flex items-center justify-center flex-shrink-0">
                  <User className="w-4 h-4 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{m.email}</p>
                  <p className="text-[11px] text-muted-foreground">Staff</p>
                </div>
                {confirmRemoveId !== m.id && (
                  <button
                    type="button"
                    onClick={() => setConfirmRemoveId(m.id)}
                    aria-label={`Remove ${m.email}`}
                    className="w-9 h-9 rounded-xl bg-white/[0.05] flex items-center justify-center flex-shrink-0"
                  >
                    <Trash2 className="w-4 h-4 text-muted-foreground" />
                  </button>
                )}
              </div>
              {confirmRemoveId === m.id && (
                <div className="mt-3 flex items-center gap-2">
                  <p className="text-xs text-muted-foreground flex-1">
                    Remove their access? What they recorded stays.
                  </p>
                  <button
                    type="button"
                    onClick={() => setConfirmRemoveId(null)}
                    disabled={removingId === m.id}
                    className="px-3 py-2 rounded-xl bg-white/[0.07] text-xs font-medium"
                  >
                    Keep
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemove(m)}
                    disabled={removingId === m.id}
                    className="px-3 py-2 rounded-xl bg-red-500 text-white text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {removingId === m.id && <Loader2 className="w-3 h-3 animate-spin" />}
                    Remove
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        <form onSubmit={handleAdd} className="bg-white/[0.05] rounded-2xl p-4 space-y-3">
          <label htmlFor="staff-email" className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Add someone by email
          </label>
          <input
            id="staff-email"
            type="email"
            inputMode="email"
            autoComplete="off"
            autoCapitalize="none"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.com"
            className="w-full rounded-xl bg-white/[0.07] px-4 py-3 text-sm"
          />
          <button
            type="submit"
            disabled={adding || email.trim() === ""}
            className="w-full flex items-center justify-center gap-2 bg-emerald-500 text-white font-semibold py-3 rounded-xl text-sm disabled:opacity-40"
          >
            {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
            Add as staff
          </button>
        </form>

        <div className="rounded-2xl border border-white/[0.06] p-4 space-y-2">
          <p className="text-xs font-semibold">What staff can do</p>
          <ul className="text-[11px] text-muted-foreground leading-relaxed list-disc pl-4 space-y-1">
            <li>Record transactions: type them in, send screenshots, confirm drafts.</li>
            <li>See balances, today&apos;s totals and the history.</li>
            <li>Discard a draft that was sent by mistake.</li>
          </ul>
          <p className="text-xs font-semibold pt-1">Only you can</p>
          <ul className="text-[11px] text-muted-foreground leading-relaxed list-disc pl-4 space-y-1">
            <li>Void a saved transaction.</li>
            <li>Correct a balance against a count.</li>
            <li>Change fees, add or remove wallets, and manage staff.</li>
          </ul>
        </div>
      </section>
    </AppShell>
  );
}
