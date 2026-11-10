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
  submitted_at: string;
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
  stage_changed_at: string;
  created_at: string;
  updated_at: string;
  lender_submissions: LenderSubmission[];
}

export interface Message {
  id: number;
  deal_id: number;
  author_id: string | null;
  kind: "user" | "system";
  body: string;
  created_at: string;
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
