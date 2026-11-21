"use client";

/**
 * Settings → Share from phone.
 *
 * A screenshot shared from the phone's share sheet arrives as a draft in
 * "Waiting for you". On an iPhone that is done with an Apple Shortcut, which
 * needs an upload key: a key that can create drafts and do nothing else.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, AlertCircle, Check, Copy, KeyRound, Trash2 } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import {
  createUploadKey, listUploadKeys, revokeUploadKey, SHARE_UPLOAD_URL, type UploadKey,
} from "@/lib/ledger";

function CopyRow({ label, value, secret = false }: { label: string; value: string; secret?: boolean }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard can be refused (no permission, not a secure context). The
      // value is on screen and selectable, so there is still a way through.
    }
  }
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</p>
      <div className="flex items-stretch gap-2">
        <code
          className={`flex-1 min-w-0 rounded-xl bg-black/40 border border-white/[0.08] px-3 py-2.5 text-[11px] break-all select-all ${
            secret ? "text-amber-200" : "text-foreground"
          }`}
        >
          {value}
        </code>
        <button
          type="button"
          onClick={copy}
          aria-label={`Copy ${label}`}
          className="px-3 rounded-xl bg-white/[0.07] flex items-center justify-center flex-shrink-0"
        >
          {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-muted-foreground" />}
        </button>
      </div>
    </div>
  );
}

function when(iso: string | null): string {
  if (!iso) return "never used";
  return "last used " + new Date(iso).toLocaleString("en-PH", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

export default function ShareSettingsPage() {
  const { loading: authLoading } = useAuthGuard();

  const [keys, setKeys] = useState<UploadKey[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;
    listUploadKeys()
      .then((k) => { if (!cancelled) setKeys(k); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Could not load your keys"); })
      .finally(() => { if (!cancelled) setDataLoading(false); });
    return () => { cancelled = true; };
  }, [authLoading]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      const { key, record } = await createUploadKey(label.trim() || "My iPhone");
      setNewKey(key);
      setKeys((prev) => [record, ...prev]);
      setLabel("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the key");
    } finally {
      setCreating(false);
    }
  }

  async function handleRemove(k: UploadKey) {
    setRemovingId(k.id);
    setError(null);
    try {
      await revokeUploadKey(k.id);
      setKeys((prev) => prev.filter((x) => x.id !== k.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove the key");
    } finally {
      setRemovingId(null);
    }
  }

  if (authLoading || dataLoading) {
    return (
      <div className="flex min-h-screen bg-background items-center justify-center">
        <Loader2 className="w-6 h-6 text-emerald-400 animate-spin" />
      </div>
    );
  }

  const headerValue = newKey ? `Bearer ${newKey}` : "Bearer (your key)";

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
          <h1 className="text-base font-semibold">Share from phone</h1>
          <p className="text-xs text-muted-foreground">Send a screenshot straight from the share sheet</p>
        </div>
      </header>

      <section className="px-5 flex-1 space-y-4 pb-10">
        {error && (
          <div className="flex items-start gap-2.5 bg-red-500/10 border border-red-500/20 rounded-2xl px-4 py-3">
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-red-300 leading-relaxed">{error}</p>
          </div>
        )}

        {/* ----- 1. the key ----- */}
        <div className="bg-white/[0.05] rounded-2xl p-4 space-y-3">
          <div>
            <p className="text-sm font-semibold">1. Make a key for this phone</p>
            <p className="text-[11px] text-muted-foreground leading-relaxed mt-1">
              The key lets the phone send screenshots in as drafts. It cannot see
              balances or save anything: a draft counts for nothing until someone
              confirms it in the app.
            </p>
          </div>

          {newKey ? (
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.07] p-3 space-y-3">
              <p className="text-[11px] text-amber-200 leading-relaxed">
                Copy this now. It is shown only once. If you lose it, remove it
                below and make another.
              </p>
              <CopyRow label="Your key" value={newKey} secret />
              <button
                type="button"
                onClick={() => setNewKey(null)}
                className="text-[11px] text-muted-foreground underline"
              >
                I&apos;ve copied it. Hide the key
              </button>
            </div>
          ) : (
            <form onSubmit={handleCreate} className="flex gap-2">
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Name it, e.g. Shop iPhone"
                maxLength={60}
                className="flex-1 min-w-0 rounded-xl bg-white/[0.07] px-3 py-2.5 text-sm"
              />
              <button
                type="submit"
                disabled={creating}
                className="flex items-center gap-2 bg-emerald-500 text-white font-semibold px-4 rounded-xl text-sm disabled:opacity-50 flex-shrink-0"
              >
                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                Make key
              </button>
            </form>
          )}

          {keys.length > 0 && (
            <div className="rounded-xl bg-black/20 divide-y divide-white/[0.06]">
              {keys.map((k) => (
                <div key={k.id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{k.label}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {k.key_prefix}… · {when(k.last_used_at)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemove(k)}
                    disabled={removingId === k.id}
                    aria-label={`Remove key ${k.label}`}
                    className="w-8 h-8 rounded-lg bg-white/[0.05] flex items-center justify-center flex-shrink-0 disabled:opacity-50"
                  >
                    {removingId === k.id
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ----- 2. the shortcut ----- */}
        <div className="bg-white/[0.05] rounded-2xl p-4 space-y-4">
          <div>
            <p className="text-sm font-semibold">2. Build the Shortcut on your iPhone</p>
            <p className="text-[11px] text-muted-foreground leading-relaxed mt-1">
              Once, in Apple&apos;s Shortcuts app. Open this page on the iPhone so
              you can copy the two values below.
            </p>
          </div>

          <CopyRow label="URL" value={SHARE_UPLOAD_URL} />
          <CopyRow label="Authorization header value" value={headerValue} secret={newKey !== null} />

          <ol className="text-xs text-muted-foreground leading-relaxed list-decimal pl-4 space-y-2.5">
            <li>
              Open <span className="text-foreground">Shortcuts</span>, tap <span className="text-foreground">+</span>,
              and name it <span className="text-foreground">Send to GoCash</span>.
            </li>
            <li>
              Tap the <span className="text-foreground">ⓘ</span> at the bottom and turn on{" "}
              <span className="text-foreground">Show in Share Sheet</span>. Back in the editor, tap the
              &quot;Receive&quot; line at the top and leave only <span className="text-foreground">Images</span> ticked.
            </li>
            <li>
              Add the action <span className="text-foreground">Convert Image</span>. Set it to convert{" "}
              <span className="text-foreground">Shortcut Input</span> to <span className="text-foreground">JPEG</span>.
            </li>
            <li>
              Add the action <span className="text-foreground">Get Contents of URL</span>. Paste the URL above.
              Tap the arrow to show more, then set:
              <ul className="list-disc pl-4 mt-1.5 space-y-1">
                <li>Method: <span className="text-foreground">POST</span></li>
                <li>
                  Headers: add one. Key <span className="text-foreground">Authorization</span>, value the
                  header value above (the word Bearer, a space, then your key).
                </li>
                <li>
                  Request Body: <span className="text-foreground">File</span>, and choose{" "}
                  <span className="text-foreground">Converted Image</span>.
                </li>
              </ul>
            </li>
            <li>
              Add <span className="text-foreground">Get Dictionary Value</span>: get the value for{" "}
              <span className="text-foreground">message</span> in <span className="text-foreground">Contents of URL</span>.
            </li>
            <li>
              Add <span className="text-foreground">Show Notification</span> and set its text to{" "}
              <span className="text-foreground">Dictionary Value</span>. Tap Done.
            </li>
          </ol>
        </div>

        {/* ----- 3. using it ----- */}
        <div className="rounded-2xl border border-white/[0.06] p-4 space-y-2">
          <p className="text-sm font-semibold">3. Use it</p>
          <ol className="text-xs text-muted-foreground leading-relaxed list-decimal pl-4 space-y-1.5">
            <li>Take the screenshot in GCash, Maya or your bank app.</li>
            <li>
              Tap the preview, tap Share, and choose <span className="text-foreground">Send to GoCash</span>.
              The first time, allow it to connect.
            </li>
            <li>A notification says what was read. Open GoCash and confirm it under &quot;Waiting for you&quot;.</li>
          </ol>
          <p className="text-[11px] text-muted-foreground/70 leading-relaxed pt-1">
            A screenshot is a record, not proof that money arrived. Check the
            wallet itself before handing over cash.
          </p>
        </div>
      </section>
    </AppShell>
  );
}
