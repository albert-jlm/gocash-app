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
import { PageHeader } from "@/components/page-header";
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
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{label}</p>
      <div className="flex items-stretch gap-2">
        <code
          className={`flex-1 min-w-0 rounded-xl bg-black/40 border border-border px-3 py-2.5 text-xs break-all select-all ${
            secret ? "text-warning" : "text-foreground"
          }`}
        >
          {value}
        </code>
        <button
          type="button"
          onClick={copy}
          aria-label={`Copy ${label}`}
          className="px-3 rounded-xl bg-muted flex items-center justify-center flex-shrink-0"
        >
          {copied ? <Check className="w-4 h-4 text-primary" /> : <Copy className="w-4 h-4 text-muted-foreground" />}
        </button>
      </div>
    </div>
  );
}

/** A word the reader has to find on the screen and tap or type. */
function B({ children }: { children: React.ReactNode }) {
  return <span className="text-foreground font-medium">{children}</span>;
}

/** One stage of building the Shortcut: a lettered heading and its taps. */
function Step({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold flex items-baseline gap-2">
        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/20 text-primary text-xs flex-shrink-0">
          {n}
        </span>
        {title}
      </p>
      <ol className="text-xs text-muted-foreground leading-relaxed list-decimal pl-9 space-y-1.5">{children}</ol>
    </div>
  );
}

function when(iso: string | null): string {
  if (!iso) return "never used";
  return "last used " + new Date(iso).toLocaleString("en-PH", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

const SHORTCUT_LINK = "https://www.icloud.com/shortcuts/d6bc3ce3cff2400fb999b348dda84f9a";

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
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
      </div>
    );
  }

  const headerValue = newKey ? `Bearer ${newKey}` : "Bearer (your key)";

  return (
    <AppShell active="settings">
      <PageHeader
        title="Share from phone"
        back="/settings"
        info={<>
          <p>The key lets a phone send screenshots in as drafts. It cannot see balances or save anything: a draft counts for nothing until someone confirms it in the app.</p>
          <p>A screenshot is a record, not proof that money arrived. Check the wallet itself before handing over cash.</p>
        </>}
      />

      <section className="px-5 flex-1 space-y-4 pb-10">
        {error && (
          <div className="flex items-start gap-2.5 bg-destructive/10 border border-destructive/20 rounded-2xl px-4 py-3">
            <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
            <p className="text-xs text-destructive leading-relaxed">{error}</p>
          </div>
        )}

        {/* ----- 1. the key ----- */}
        <div className="bg-muted/60 rounded-2xl p-4 space-y-3">
          <div>
            <p className="text-sm font-semibold">1. Make a key for this phone</p>
          </div>

          {newKey ? (
            <div className="rounded-xl border border-warning/25 bg-warning/[0.07] p-3 space-y-3">
              <p className="text-xs text-warning leading-relaxed">
                Copy this now. It is shown only once. If you lose it, remove it
                below and make another.
              </p>
              <CopyRow label="Your key" value={newKey} secret />
              <button
                type="button"
                onClick={() => setNewKey(null)}
                className="text-xs text-muted-foreground underline"
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
                className="flex-1 min-w-0 rounded-xl bg-muted px-3 py-2.5 text-sm"
              />
              <button
                type="submit"
                disabled={creating}
                className="flex items-center gap-2 bg-primary text-primary-foreground font-semibold px-4 rounded-xl text-sm disabled:opacity-50 flex-shrink-0"
              >
                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                Make key
              </button>
            </form>
          )}

          {keys.length > 0 && (
            <div className="rounded-xl bg-black/20 divide-y divide-border">
              {keys.map((k) => (
                <div key={k.id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{k.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {k.key_prefix}… · {when(k.last_used_at)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemove(k)}
                    disabled={removingId === k.id}
                    aria-label={`Remove key ${k.label}`}
                    className="w-8 h-8 rounded-lg bg-muted/60 flex items-center justify-center flex-shrink-0 disabled:opacity-50"
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
        <div className="bg-muted/60 rounded-2xl p-4 space-y-4">
          <div>
            <p className="text-sm font-semibold">2. Add the Shortcut on your iPhone</p>
            <p className="text-sm text-muted-foreground leading-relaxed mt-1">
              Open this page on the iPhone and tap the button. When it asks,
              paste the key from step 1.
            </p>
          </div>

          <a
            href={SHORTCUT_LINK}
            target="_blank"
            rel="noopener noreferrer"
            className="font-heading w-full h-[54px] rounded-full bg-primary text-primary-foreground font-semibold text-[17px] flex items-center justify-center"
          >
            Add the Shortcut
          </a>

          <details className="group">
            <summary className="text-sm text-muted-foreground underline underline-offset-4 cursor-pointer list-none py-2">
              Build it by hand instead
            </summary>
            <div className="space-y-4 pt-3">
          <CopyRow label="URL" value={SHARE_UPLOAD_URL} />
          <CopyRow label="Authorization header value" value={headerValue} secret={newKey !== null} />

          <p className="text-xs text-muted-foreground leading-relaxed">
            You add four actions, in this order. To add one, tap the search bar
            at the bottom of the Shortcuts editor, type its name and tap it.
            The wording below is from recent iOS versions and may differ slightly on yours.
          </p>

          <Step n="A" title="Create it and put it in the Share menu">
            <li>Open the <B>Shortcuts</B> app. Tap <B>+</B> at the top right.</li>
            <li>Tap the name at the top (<B>New Shortcut</B>), choose <B>Rename</B>, and type <B>Send to GoCash</B>.</li>
            <li>Tap the <B>ⓘ</B> button at the bottom. Switch on <B>Show in Share Sheet</B>. Tap <B>Done</B>.</li>
            <li>
              A line now appears at the top: &quot;Receive <B>Any</B> input from <B>Share Sheet</B>&quot;.
              Tap <B>Any</B>, tap <B>Clear</B>, then tick only <B>Images</B>. Tap <B>Done</B>.
            </li>
          </Step>

          <Step n="B" title="Action 1: Convert Image">
            <li>Search for <B>Convert Image</B> and tap it.</li>
            <li>It should read &quot;Convert <B>Shortcut Input</B> to <B>JPEG</B>&quot;. If it says another format, tap it and pick JPEG.</li>
          </Step>

          <Step n="C" title="Action 2: Get Contents of URL (this sends the screenshot)">
            <li>Search for <B>Get Contents of URL</B> and tap it.</li>
            <li>Tap the faded word <B>URL</B> in the action and paste the URL from above.</li>
            <li>Tap the small <B>arrow (›)</B> on the right of the action to show more options.</li>
            <li>Tap <B>Method</B> and choose <B>POST</B>.</li>
            <li>
              Under <B>Headers</B>, tap <B>Add new header</B>. In <B>Key</B> type <B>Authorization</B>.
              In <B>Text</B> paste the header value from above. It must be the word Bearer, one space, then your key.
            </li>
            <li>Tap <B>Request Body</B> and choose <B>File</B>.</li>
            <li>Tap <B>File</B> (the field that appears) and choose <B>Converted Image</B>.</li>
          </Step>

          <Step n="D" title="Action 3: Get Dictionary Value (this reads the reply)">
            <li>Search for <B>Get Dictionary Value</B> and tap it.</li>
            <li>It should read &quot;Get <B>Value</B> for <B>Key</B> in <B>Contents of URL</B>&quot;.</li>
            <li>Tap <B>Key</B> and type <B>message</B>, in small letters.</li>
          </Step>

          <Step n="E" title="Action 4: Show Notification">
            <li>Search for <B>Show Notification</B> and tap it.</li>
            <li>Tap the text <B>Hello World</B> and delete it.</li>
            <li>In the row of suggestions above the keyboard, tap <B>Dictionary Value</B>.</li>
            <li>Tap <B>Done</B> at the top right. The Shortcut is finished.</li>
          </Step>

          <div className="rounded-xl bg-black/20 p-3 space-y-1.5">
            <p className="text-xs font-semibold">If it doesn&apos;t work</p>
            <ul className="text-xs text-muted-foreground leading-relaxed list-disc pl-4 space-y-1">
              <li><B>&quot;The upload key is missing&quot;</B>: the header key isn&apos;t exactly Authorization, or the value doesn&apos;t start with Bearer and a space.</li>
              <li><B>&quot;This upload key is not valid any more&quot;</B>: the key was mistyped or removed. Make a new one above and paste it again.</li>
              <li><B>&quot;No image arrived&quot;</B>: Request Body isn&apos;t set to File, or File isn&apos;t Converted Image.</li>
              <li><B>The notification is empty</B>: the key in action 3 isn&apos;t exactly <B>message</B>.</li>
            </ul>
          </div>
            </div>
          </details>

          <p className="text-[13px] text-muted-foreground leading-relaxed">
            If <B>Send to GoCash</B> isn&apos;t in the Share menu, scroll to the bottom of the menu,
            tap <B>Edit Actions</B> and add it. If it says the key is not valid, make a new key
            above, then edit the Shortcut and paste it into the first box.
          </p>
        </div>

        {/* ----- 3. using it ----- */}
        <div className="rounded-2xl border border-border p-4 space-y-2">
          <p className="text-sm font-semibold">3. Use it</p>
          <ol className="text-xs text-muted-foreground leading-relaxed list-decimal pl-4 space-y-1.5">
            <li>Take the screenshot in GCash, Maya or your bank app.</li>
            <li>
              Tap the preview, tap Share, and choose <span className="text-foreground">Send to GoCash</span>.
              The first time, allow it to connect.
            </li>
            <li>A notification says what was read. Open GoCash and confirm it under &quot;drafts to review&quot;.</li>
          </ol>
          <p className="text-xs text-muted-foreground/70 leading-relaxed pt-1">
            A screenshot is a record, not proof that money arrived. Check the
            wallet itself before handing over cash.
          </p>
        </div>
      </section>
    </AppShell>
  );
}
