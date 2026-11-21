"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronLeft, Info } from "lucide-react";
import { Sheet } from "@/components/sheet";

export function InfoButton({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`About ${title}`}
        className={`w-11 h-11 grid place-items-center text-muted-foreground ${className}`}
      >
        <Info className="w-[22px] h-[22px]" strokeWidth={1.9} />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={title}>
        <div className="text-[15px] leading-relaxed text-muted-foreground space-y-3 mt-2 mb-5 [&_b]:text-foreground [&_b]:font-medium">
          {children}
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="font-heading w-full h-[54px] rounded-full bg-muted font-semibold text-[17px]"
        >
          Got it
        </button>
      </Sheet>
    </>
  );
}

export function PageHeader({
  title,
  back,
  info,
  action,
}: {
  title: string;
  back?: string;
  info?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <header className="px-6 pt-[calc(env(safe-area-inset-top)+1.25rem)] lg:pt-10 pb-4 grid grid-cols-[44px_1fr_44px] items-center">
      {back ? (
        <Link href={back} aria-label="Back" className="w-11 h-11 -ml-2.5 grid place-items-center">
          <ChevronLeft className="w-[22px] h-[22px]" />
        </Link>
      ) : (
        <span />
      )}
      <h1 className="text-[17px] font-semibold text-center truncate">{title}</h1>
      {action ?? (info ? <InfoButton title={title} className="-mr-2.5">{info}</InfoButton> : <span />)}
    </header>
  );
}
