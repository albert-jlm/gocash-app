import { redirect } from "next/navigation";
import { buildFinancialSettingsHref } from "@/lib/platforms";

export default function RulesSettingsRedirectPage() {
  redirect(buildFinancialSettingsHref("profit"));
}
