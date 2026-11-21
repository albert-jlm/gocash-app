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
import { PageHeader } from "@/components/page-header";
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
        title="Staff"
        back="/settings"
        info={<>
          <p>Staff can record and view transactions.</p>
          <p>Only you can void, reconcile, change fees, wallets, staff and your own numbers.</p>
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

        <div className="bg-muted rounded-2xl overflow-hidden divide-y divide-border">
          <div className="flex items-center gap-3 px-4 py-3.5">
            <div className="w-9 h-9 rounded-xl bg-warning/15 flex items-center justify-center flex-shrink-0">
              <Crown className="w-4 h-4 text-warning" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[15px] font-medium truncate">{ownerEmail ?? "You"}</p>
              <p className="text-[13px] text-muted-foreground">Owner · you</p>
            </div>
          </div>

          {staff.map((m) => (
            <div key={m.id} className="px-4 py-3.5">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center flex-shrink-0">
                  <User className="w-4 h-4 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[15px] font-medium truncate">{m.email}</p>
                  <p className="text-[13px] text-muted-foreground">Staff</p>
                </div>
                {confirmRemoveId !== m.id && (
                  <button
                    type="button"
                    onClick={() => setConfirmRemoveId(m.id)}
                    aria-label={`Remove ${m.email}`}
                    className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center flex-shrink-0"
                  >
                    <Trash2 className="w-4 h-4 text-muted-foreground" />
                  </button>
                )}
              </div>
              {confirmRemoveId === m.id && (
                <div className="mt-3 flex items-center gap-2">
                  <p className="text-[13px] text-muted-foreground flex-1">
                    Remove their access? What they recorded stays.
                  </p>
                  <button
                    type="button"
                    onClick={() => setConfirmRemoveId(null)}
                    disabled={removingId === m.id}
                    className="btn btn-secondary btn-sm"
                  >
                    Keep
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemove(m)}
                    disabled={removingId === m.id}
                    className="btn btn-danger btn-sm"
                  >
                    {removingId === m.id && <Loader2 className="w-3 h-3 animate-spin" />}
                    Remove
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        <form onSubmit={handleAdd} className="bg-muted rounded-2xl p-4 space-y-3">
          <label htmlFor="staff-email" className="label">
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
            className="w-full rounded-xl bg-muted px-4 py-3 text-[15px]"
          />
          <button
            type="submit"
            disabled={adding || email.trim() === ""}
            className="btn btn-primary w-full"
          >
            {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
            Add as staff
          </button>
        </form>

        <div className="rounded-2xl border border-border p-4 space-y-2">
          <p className="text-[13px] font-semibold">What staff can do</p>
          <ul className="text-[13px] text-muted-foreground leading-relaxed list-disc pl-4 space-y-1">
            <li>Record transactions: type them in, send screenshots, confirm drafts.</li>
            <li>See balances, today&apos;s totals and the history.</li>
            <li>Discard a draft that was sent by mistake.</li>
          </ul>
          <p className="text-[13px] font-semibold pt-1">Only you can</p>
          <ul className="text-[13px] text-muted-foreground leading-relaxed list-disc pl-4 space-y-1">
            <li>Void a saved transaction.</li>
            <li>Correct a balance against a count.</li>
            <li>Change fees, add or remove wallets, and manage staff.</li>
          </ul>
        </div>
      </section>
    </AppShell>
  );
}
