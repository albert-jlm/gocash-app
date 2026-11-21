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
import { addStaff, listStaff, removeStaff, setStaffRole, type StaffMember } from "@/lib/ledger";

export default function StaffSettingsPage() {
  const { loading: authLoading } = useAuthGuard({ ownerOnly: true });

  const [ownerEmail, setOwnerEmail] = useState<string | null>(null);
  const [yourEmail, setYourEmail] = useState<string | null>(null);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [newRole, setNewRole] = useState<"staff" | "owner">("staff");
  const [changingId, setChangingId] = useState<string | null>(null);

  async function handleRole(member: StaffMember) {
    const next = member.role === "owner" ? "staff" : "owner";
    setChangingId(member.id);
    setError(null);
    setNotice(null);
    try {
      await setStaffRole(member.id, next);
      setStaff((prev) => prev.map((m) => (m.id === member.id ? { ...m, role: next } : m)));
      setNotice(`${member.email} is now ${next === "owner" ? "an owner" : "staff"}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change that person's role");
    } finally {
      setChangingId(null);
    }
  }
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
      .then((r) => { if (!cancelled) { setOwnerEmail(r.ownerEmail); setYourEmail(r.yourEmail); setStaff(r.staff); } })
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
      const member = await addStaff(trimmed, newRole);
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
        title="People"
        back="/settings"
        info={<>
          <p><b>Staff</b> can record transactions, send screenshots, review drafts, and see balances and history.</p>
          <p><b>Owners</b> can also void, fix balances, change fees and wallets, edit earnings, and add or remove people.</p>
          <p>The first owner cannot be removed or changed.</p>
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
              <p className="text-[15px] font-medium truncate">{ownerEmail ?? "Owner"}</p>
              <p className="text-[13px] text-muted-foreground">Owner{ownerEmail && ownerEmail === yourEmail ? " · you" : ""}</p>
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
                  <p className="text-[13px] text-muted-foreground">
                    {m.role === "owner" ? "Owner" : "Staff"}{m.email === yourEmail ? " · you" : ""}
                  </p>
                </div>
                {confirmRemoveId !== m.id && m.email !== yourEmail && (
                  <button
                    type="button"
                    onClick={() => handleRole(m)}
                    disabled={changingId === m.id}
                    className="btn btn-outline btn-sm"
                  >
                    {changingId === m.id ? <Loader2 className="w-4 h-4 animate-spin" /> : m.role === "owner" ? "Make staff" : "Make owner"}
                  </button>
                )}
                {confirmRemoveId !== m.id && m.email !== yourEmail && (
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
            className="field bg-background"
          />
          <div role="radiogroup" aria-label="Role" className="grid grid-cols-2 gap-1 rounded-full bg-background p-1">
            {(["staff", "owner"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={newRole === value}
                onClick={() => setNewRole(value)}
                className={`h-11 rounded-full text-[15px] font-medium ${newRole === value ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
              >
                {value === "staff" ? "Staff" : "Owner"}
              </button>
            ))}
          </div>
          <button
            type="submit"
            disabled={adding || email.trim() === ""}
            className="btn btn-primary w-full"
          >
            {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
            {newRole === "owner" ? "Add as owner" : "Add as staff"}
          </button>
        </form>

      </section>
    </AppShell>
  );
}
