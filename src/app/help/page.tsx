import Link from "next/link";

const STEPS: { title: string; body: string }[] = [
  { title: "Sign in", body: "Enter your email. We send a six-digit code; type it in. There is no password." },
  { title: "Enter what you hold today", body: "Settings → Wallets. For the cash drawer and each wallet, tap Set the real balance and type what is really there." },
  { title: "Add your own numbers", body: "Settings → My numbers & accounts. This lets the app tell a customer apart from you moving your own money." },
  { title: "Put it on your home screen", body: "iPhone: open it in Safari, tap Share, then Add to Home Screen. Android: open it in Chrome, tap the menu, then Add to Home screen." },
];

const HOW: { title: string; steps: string[] }[] = [
  {
    title: "Record a Cash In or Cash Out",
    steps: [
      "On Home, tap Cash In or Cash Out.",
      "Pick the wallet, then type the amount on the keypad.",
      "Check the line under the amount: it says what each balance does and what you earn.",
      "Tap Save. If it was a mistake, the owner can tap Undo on Home straight away.",
    ],
  },
  {
    title: "Record from a screenshot",
    steps: [
      "Take the screenshot of the receipt in GCash, Maya or your bank app.",
      "In GoCash, tap Scan and pick the screenshot.",
      "Check what was read, fill in anything it could not find, and tap Save.",
    ],
  },
  {
    title: "Send screenshots from an iPhone's Share menu",
    steps: [
      "Settings → Share from phone. Make a key and copy it.",
      "Tap Add the Shortcut and paste the key when it asks.",
      "From then on: take a screenshot, tap Share, choose Send to GoCash.",
      "It arrives as a draft. Open GoCash and review it under drafts to review.",
    ],
  },
  {
    title: "Move your own money between wallets",
    steps: [
      "Home → More → Move my own money.",
      "Pick where it came from and where it went, then the amount that arrived.",
      "If the app charged you a fee, enter it. It is recorded as a cost and does not reduce your earnings.",
    ],
  },
  {
    title: "Take out your profit",
    steps: [
      "On Home, tap the Earnings card, then Take out profit.",
      "Enter the amount you are taking from the drawer and save.",
    ],
  },
  {
    title: "Fix a balance that is wrong",
    steps: [
      "Settings → Wallets, then Set the real balance on that wallet.",
      "Type what it really holds and save. The correction is kept on record.",
    ],
  },
  {
    title: "Get told when a wallet is running low",
    steps: [
      "Settings → Wallets, then Alert below on that wallet.",
      "Enter the lowest amount you want to keep in it. Home shows a Top up notice when it drops below.",
    ],
  },
  {
    title: "Let staff record transactions",
    steps: [
      "Settings → Staff. Add their email.",
      "They sign in with that email. They can record and view; only you can void, fix balances and change settings.",
    ],
  },
];

const FAQ: { q: string; a: string }[] = [
  { q: "Does GoCash move money or connect to GCash or Maya?", a: "No. It only keeps your records. You do the transaction in the wallet app as usual, then record it here." },
  { q: "Does a screenshot prove the money arrived?", a: "No. A screenshot is a record, and fake receipts exist. Check the wallet itself before you hand over cash." },
  { q: "What is a draft?", a: "A transaction read from a screenshot that nobody has checked yet. It changes no balance and earns nothing until you review and save it." },
  { q: "How is my fee worked out?", a: "By the rules under Settings → Profit settings: the amount times your rate, and never less than your minimum." },
  { q: "What does the Earnings card show?", a: "The fees you have earned and not yet taken out. That money is still inside your drawer and wallets, so their balances keep matching the real ones." },
  { q: "I saved something wrong. Can I delete it?", a: "You void it. The balances go back to what they were and it stays in History marked as voided. Then record it again correctly. Only the owner can void." },
  { q: "Why can't I just type over a balance?", a: "You can set it to the real figure under Settings → Wallets. The app records the difference as a correction so you can always see why a balance changed." },
  { q: "The app looks like a web page.", a: "Add it to your home screen (see Getting started). Opened from there it runs full screen, without the browser bars." },
  { q: "Can I use it in light or dark mode?", a: "Yes. Settings → Appearance. It follows your phone unless you choose one." },
];

export const metadata = { title: "GoCash help" };

export default function HelpPage() {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto w-full max-w-2xl px-6 pt-[calc(env(safe-area-inset-top)+1.5rem)] pb-16">
        <header className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <img src="/logo.svg" alt="" width={34} height={34} className="rounded-[10px] dark:ring-1 dark:ring-input" />
            <span className="font-heading text-xl font-bold tracking-tight">gocash</span>
          </Link>
          <Link href="/" className="font-heading h-11 px-5 rounded-full bg-primary text-primary-foreground font-semibold text-[15px] grid place-items-center">
            Open the app
          </Link>
        </header>

        <section className="pt-14 pb-12">
          <h1 className="text-[40px] leading-[1.05] font-bold tracking-tight">
            Your shop&apos;s cash-in and cash-out books,{" "}
            <span className="bg-spark text-spark-foreground px-1.5 rounded-md dark:px-0">kept for you.</span>
          </h1>
          <p className="text-[17px] text-muted-foreground mt-5 leading-relaxed">
            Record each transaction in a few taps or from a screenshot. GoCash keeps the
            balance of every wallet, the cash that should be in the drawer, and what you earned.
          </p>
        </section>

        <section className="pb-12">
          <h2 className="text-[22px] font-semibold mb-4">Getting started</h2>
          <ol className="space-y-4">
            {STEPS.map((step, i) => (
              <li key={step.title} className="flex gap-4">
                <span className="amount w-9 h-9 rounded-full bg-action text-action-foreground grid place-items-center font-semibold flex-shrink-0">{i + 1}</span>
                <span>
                  <span className="block text-[17px] font-medium">{step.title}</span>
                  <span className="block text-[15px] text-muted-foreground leading-relaxed">{step.body}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>

        <section className="pb-12">
          <h2 className="text-[22px] font-semibold mb-2">How to</h2>
          {HOW.map((item) => (
            <details key={item.title} className="border-b border-border group">
              <summary className="flex items-center justify-between gap-4 py-4 text-[17px] font-medium cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                {item.title}
                <span className="text-2xl text-muted-foreground leading-none group-open:rotate-45 transition-transform">+</span>
              </summary>
              <ol className="list-decimal pl-5 pb-5 space-y-1.5 text-[15px] text-muted-foreground leading-relaxed">
                {item.steps.map((s) => <li key={s}>{s}</li>)}
              </ol>
            </details>
          ))}
        </section>

        <section>
          <h2 className="text-[22px] font-semibold mb-2">Questions</h2>
          {FAQ.map((item) => (
            <details key={item.q} className="border-b border-border group">
              <summary className="flex items-center justify-between gap-4 py-4 text-[17px] font-medium cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                {item.q}
                <span className="text-2xl text-muted-foreground leading-none group-open:rotate-45 transition-transform">+</span>
              </summary>
              <p className="pb-5 text-[15px] text-muted-foreground leading-relaxed">{item.a}</p>
            </details>
          ))}
        </section>
      </div>
    </div>
  );
}
