// Generated Supabase types for the gocash schema.
// Run: supabase gen types typescript --schema gocash > src/types/database.ts
// For now this is a manual stub — regenerate after Supabase CLI setup.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type TransactionType =
  | "Cash In"
  | "Cash Out"
  | "Telco Load"
  | "Bills Payment"
  | "Bank Transfer"
  | "Profit Remittance"
  | "Unknown";

export type TransactionStatus =
  | "uploaded"
  | "processing"
  | "awaiting_confirmation"
  | "confirmed"
  | "edited"
  | "failed";

export type WalletType = "platform" | "cash";

export interface Database {
  gocash: {
    Tables: {
      operators: {
        Row: {
          id: string;
          email: string;
          name: string;
          phone: string | null;
          telegram_chat_id: string | null;
          settings: Json;
          subscription_tier: "free" | "basic" | "premium";
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["gocash"]["Tables"]["operators"]["Row"],
          "created_at" | "updated_at"
        >;
        Update: Partial<Database["gocash"]["Tables"]["operators"]["Insert"]>;
      };
      transactions: {
        Row: {
          id: string;
          operator_id: string;
          transaction_type: TransactionType;
          platform: string;
          account_number: string | null;
          amount: number;
          net_profit: number;
          reference_number: string | null;
          transaction_date: string | null;
          time_24hr: string | null;
          full_date: string | null;
          year: string | null;
          month: string | null;
          day: string | null;
          image_url: string | null;
          status: TransactionStatus;
          was_edited: boolean;
          edit_history: Json;
          processing_errors: string[] | null;
          starting_cash: number | null;
          wallet_balance: number | null;
          created_at: string;
          updated_at: string;
          confirmed_at: string | null;
          confirmed_by: string | null;
        };
        Insert: Omit<
          Database["gocash"]["Tables"]["transactions"]["Row"],
          | "id"
          | "created_at"
          | "updated_at"
          | "year"
          | "month"
          | "day"
        >;
        Update: Partial<Database["gocash"]["Tables"]["transactions"]["Insert"]>;
      };
      wallets: {
        Row: {
          id: string;
          operator_id: string;
          wallet_type: WalletType;
          wallet_name: string;
          balance: number;
          last_transaction_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["gocash"]["Tables"]["wallets"]["Row"],
          "id" | "created_at" | "updated_at"
        >;
        Update: Partial<Database["gocash"]["Tables"]["wallets"]["Insert"]>;
      };
      transaction_rules: {
        Row: {
          id: string;
          operator_id: string;
          transaction_type: string;
          platform: string;
          delta_platform_mult: number;
          delta_cash_amount_mult: number;
          delta_cash_mult: number;
          profit_rate: number | null;
          profit_minimum: number | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["gocash"]["Tables"]["transaction_rules"]["Row"],
          "id" | "created_at" | "updated_at"
        >;
        Update: Partial<
          Database["gocash"]["Tables"]["transaction_rules"]["Insert"]
        >;
      };
      audit_logs: {
        Row: {
          id: string;
          operator_id: string | null;
          entity_type: string;
          entity_id: string;
          action: string;
          changes: Json | null;
          metadata: Json | null;
          created_at: string;
        };
        Insert: Omit<
          Database["gocash"]["Tables"]["audit_logs"]["Row"],
          "id" | "created_at"
        >;
        Update: never;
      };
    };
  };
}
