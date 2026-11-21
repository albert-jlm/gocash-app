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

// Matches transactions_status_check after 20260924000006: "edited" is gone
// (an edit is a void and a new entry) and "voided" was added.
export type TransactionStatus =
  | "uploaded"
  | "processing"
  | "awaiting_confirm"
  | "confirmed"
  | "voided"
  | "failed";

// Account classes live in the ledger core so the client and the Edge Functions
// cannot drift apart on them: "platform" | "cash" | "revenue" | "equity".
import type { AccountKind } from "@core/types.ts";
export type { AccountKind };

// NOTE: `WalletType` and the `wallets` table are gone. Balances are no longer
// stored anywhere — they are derived from `gocash.postings` and read through
// the `gocash.account_balances` view. `wallets` is dropped by its own migration.

export interface Database {
  gocash: {
    Tables: {
      operators: {
        Row: {
          id: string;
          user_id: string | null;
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
        Insert: {
          user_id?: string | null;
          email: string;
          name: string;
          phone?: string | null;
          telegram_chat_id?: string | null;
          settings?: Json;
          subscription_tier?: "free" | "basic" | "premium";
          is_active?: boolean;
        };
        Update: Partial<Database["gocash"]["Tables"]["operators"]["Insert"]>;
        Relationships: [];
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
          ai_raw_text: string | null;
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
        Insert: {
          operator_id: string;
          transaction_type: TransactionType;
          platform: string;
          amount: number;
          net_profit: number;
          status: TransactionStatus;
          account_number?: string | null;
          reference_number?: string | null;
          transaction_date?: string | null;
          time_24hr?: string | null;
          full_date?: string | null;
          image_url?: string | null;
          ai_raw_text?: string | null;
          was_edited?: boolean;
          edit_history?: Json;
          processing_errors?: string[] | null;
          starting_cash?: number | null;
          wallet_balance?: number | null;
          confirmed_at?: string | null;
          confirmed_by?: string | null;
        };
        Update: Partial<Database["gocash"]["Tables"]["transactions"]["Insert"]>;
        Relationships: [];
      };
      // Replaces `wallets`. There is no balance column by design — see the
      // `account_balances` view below.
      accounts: {
        Row: {
          id: string;
          operator_id: string;
          kind: AccountKind;
          name: string;
          currency: string;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          operator_id: string;
          kind: AccountKind;
          name: string;
          currency?: string;
          is_active?: boolean;
        };
        Update: Partial<Database["gocash"]["Tables"]["accounts"]["Insert"]>;
        Relationships: [];
      };
      // The ledger itself. Append-only and written exclusively by the Edge
      // Functions with the service-role key: RLS grants the browser SELECT and
      // nothing else, so both of these are read-only from `src/`.
      ledger_entries: {
        Row: {
          id: string;
          operator_id: string;
          transaction_id: string | null;
          kind: "opening" | "transaction" | "reversal" | "reconciliation";
          reverses_entry_id: string | null;
          currency: string;
          memo: string | null;
          idempotency_key: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      postings: {
        Row: {
          id: string;
          entry_id: string;
          account_id: string;
          operator_id: string;
          amount_minor: number;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      /**
       * Replaces transaction_rules, which 20260924000006 drops.
       *
       * That table mixed pricing with the three delta_* multipliers that
       * decided which direction money moved. Direction is now code
       * (supabase/functions/_core/postings.ts); only pricing is data.
       *
       * Effective-dated: rows are never edited, a price change closes the
       * current period and opens a new one via gocash.set_fee_rule(). So there
       * is no Update, and Insert is never — writes go through the function,
       * which keeps the no-overlap constraint satisfied and checks ownership.
       */
      fee_rules: {
        Row: {
          id: string;
          operator_id: string;
          transaction_type: string;
          platform: string;
          /** Basis points: 200 = 2.00%. */
          rate_bps: number;
          /** Centavos: 500 = PHP 5.00. */
          minimum_minor: number;
          rounding: "ceil_unit" | "nearest_minor";
          effective_from: string;
          /** NULL means this is the rule in force now. */
          effective_to: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
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
        Insert: {
          operator_id?: string | null;
          entity_type: string;
          entity_id: string;
          action: string;
          changes?: Json | null;
          metadata?: Json | null;
        };
        Update: never;
        Relationships: [];
      };
    };
    Views: {
      // Derived balances — the replacement for `wallets.balance`.
      //
      // `balance_minor` is integer centavos, `balance` the same value in pesos,
      // and `natural_balance` is what a human should read: for `revenue` and
      // `equity` (credit-natured, so they grow negative) it is sign-flipped, so
      // fees earned display as a positive number. Display `natural_balance`.
      account_balances: {
        Row: {
          account_id: string;
          operator_id: string;
          name: string;
          kind: AccountKind;
          currency: string;
          balance_minor: number;
          balance: number;
          natural_balance: number;
          posting_count: number;
          last_posted_at: string | null;
        };
        Relationships: [];
      };
      // Health check: any row here is a bug.
      unbalanced_entries: {
        Row: {
          entry_id: string;
          operator_id: string;
          kind: string;
          created_at: string;
          out_of_balance_by_minor: number | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      /**
       * Change a price. Not an UPDATE — it closes the current period and opens
       * a new one atomically, so history survives and an amended transaction
       * reprices at the rate that applied on its own date.
       *
       * Granted to authenticated, and it verifies the caller owns the operator
       * from the signed JWT claim. This is the only gocash function the browser
       * may call; every other one was revoked in 20260923000001 after an audit
       * found six of them executable with the public anon key.
       */
      set_fee_rule: {
        Args: {
          p_operator_id: string;
          p_transaction_type: string;
          p_platform: string;
          p_rate_bps: number;
          p_minimum_minor: number;
          p_rounding?: "ceil_unit" | "nearest_minor";
        };
        Returns: string;
      };
      /** The caller's own operator and role. Zero rows means "not set up". */
      my_membership: {
        Args: Record<string, never>;
        Returns: { operator_id: string; role: "owner" | "staff" }[];
      };
    };
  };
}
