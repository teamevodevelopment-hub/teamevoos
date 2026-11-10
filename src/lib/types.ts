export type Role = "admin" | "lead" | "agent";

export type StageId =
  | "new"
  | "docs"
  | "ready"
  | "submitted"
  | "approved"
  | "car"
  | "closed"
  | "declined"
  | "lost";

export interface Profile {
  id: string;
  name: string;
  role: Role;
}

export interface LenderSubmission {
  id: number;
  deal_id: number;
  lender: string;
  status: "pending" | "approved" | "declined";
  terms: string | null;
  amount: number | null;
  rate: number | null;
  term_months: number | null;
  payment: number | null;
  payment_freq: PaymentFreq | null;
  submitted_at: string;
}

export type PaymentFreq = "monthly" | "biweekly" | "weekly";

export interface Condition {
  id: number;
  deal_id: number;
  label: string;
  done_at: string | null;
  done_by: string | null;
  created_by: string;
  created_at: string;
}

export interface Deal {
  id: number;
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  agent_id: string;
  stage: StageId;
  prev_stage: StageId | null;
  lost_reason: string | null;
  dealertrack_no: string | null;
  notes: string | null;
  licence_front: string | null;
  licence_back: string | null;
  vehicle_desc: string | null;
  vehicle_price: number | null;
  dealer: string | null;
  vehicle_year: number | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_trim: string | null;
  vehicle_km: number | null;
  vin: string | null;
  down_payment: number | null;
  trade_in_desc: string | null;
  trade_in_value: number | null;
  stage_changed_at: string;
  created_at: string;
  updated_at: string;
  lender_submissions: LenderSubmission[];
  deal_conditions: Condition[];
}

export type FileKind = "image" | "file" | "voice";

/** Optional attachment on any chat message. */
export interface FileFields {
  file_path?: string | null;
  file_kind?: FileKind | null;
  file_name?: string | null;
  file_size?: number | null;
  file_ms?: number | null;
}

export interface Message extends FileFields {
  id: number;
  deal_id: number;
  author_id: string | null;
  kind: "user" | "system";
  body: string;
  created_at: string;
}

export interface DirectMessage extends FileFields {
  id: number;
  sender_id: string;
  recipient_id: string;
  body: string;
  reply_to: number | null;
  deleted_at: string | null;
  created_at: string;
}

/** When someone last read a chat: "team", "deal:<id>" or "dm:<other person's id>". */
export interface ChatRead {
  user_id: string;
  chat: string;
  last_read_at: string;
}

export interface DealEvent {
  id: number;
  deal_id: number;
  actor_id: string | null;
  body: string;
  created_at: string;
}

export interface Notification {
  id: number;
  user_id: string;
  deal_id: number | null;
  actor_id: string | null;
  kind: "mention" | "update";
  body: string;
  read_at: string | null;
  created_at: string;
  deals: { first_name: string; last_name: string } | null;
}

export interface TeamMessage extends FileFields {
  id: number;
  author_id: string | null;
  kind: "user" | "celebration";
  body: string;
  deal_id: number | null;
  reply_to: number | null;
  deleted_at: string | null;
  created_at: string;
}

export interface TeamReaction {
  message_id: number;
  user_id: string;
  emoji: string;
}

export interface NamedRow {
  id: number;
  name: string;
  active: boolean;
}

export interface Idea {
  id: number;
  body: string;
  created_by: string;
  created_at: string;
}
