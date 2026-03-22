import { redirect } from "next/navigation";
import { buildFinancialSettingsHref } from "@/lib/platforms";

export default function WalletsSettingsRedirectPage() {
  redirect(buildFinancialSettingsHref("wallets"));
}
