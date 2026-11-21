import { supabase } from "@/lib/supabase/client";

export type Floors = Record<string, number>;

export function readFloors(settings: unknown): Floors {
  const raw = (settings as { low_balance?: unknown } | null)?.low_balance;
  if (!raw || typeof raw !== "object") return {};
  const out: Floors = {};
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) out[name] = value;
  }
  return out;
}

export async function loadFloors(operatorId: string): Promise<Floors> {
  const { data, error } = await supabase.from("operators").select("settings").eq("id", operatorId).single();
  if (error) throw new Error(error.message);
  return readFloors(data?.settings);
}

export async function saveFloor(operatorId: string, walletName: string, pesos: number | null): Promise<Floors> {
  const { data, error } = await supabase.from("operators").select("settings").eq("id", operatorId).single();
  if (error) throw new Error(error.message);
  const settings = (data?.settings ?? {}) as Record<string, unknown>;
  const floors = readFloors(settings);
  if (pesos === null || pesos <= 0) delete floors[walletName];
  else floors[walletName] = pesos;
  const { error: writeError } = await supabase
    .from("operators")
    .update({ settings: { ...settings, low_balance: floors } })
    .eq("id", operatorId);
  if (writeError) throw new Error(writeError.message);
  return floors;
}
