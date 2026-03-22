
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
      wallets: {
        Row: {
          id: string;
          operator_id: string;
          wallet_type: WalletType;
          wallet_name: string;
          balance: number;
          color: string;
          is_active: boolean;
          last_transaction_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          operator_id: string;
          wallet_type: WalletType;
          wallet_name: string;
          balance?: number;
          color?: string;
          is_active?: boolean;
          last_transaction_id?: string | null;
        };
        Update: Partial<Database["gocash"]["Tables"]["wallets"]["Insert"]>;
        Relationships: [];
      };
      operator_platforms: {
        Row: {
          id: string;
          operator_id: string;
          name: string;
          is_builtin: boolean;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          operator_id: string;
          name: string;
          is_builtin?: boolean;
          is_active?: boolean;
        };
        Update: Partial<Database["gocash"]["Tables"]["operator_platforms"]["Insert"]>;
        Relationships: [];
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
        Insert: {
          operator_id: string;
          transaction_type: string;
          platform: string;
          delta_platform_mult: number;
          delta_cash_amount_mult: number;
          delta_cash_mult: number;
          profit_rate?: number | null;
          profit_minimum?: number | null;
          is_active?: boolean;
        };
        Update: Partial<Database["gocash"]["Tables"]["transaction_rules"]["Insert"]>;
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
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
}
