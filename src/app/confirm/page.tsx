"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import ConfirmForm from "./[id]/confirm-form";

function ConfirmPageInner() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id") ?? "preview";
  return <ConfirmForm transactionId={id} />;
}

export default function ConfirmPage() {
  return (
    <Suspense fallback={null}>
      <ConfirmPageInner />
    </Suspense>
  );
}
