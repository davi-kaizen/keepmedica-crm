// KeepMedica V2 — TypeScript interfaces

export interface Pipeline {
  id: number;
  name: string;
}

export interface Stage {
  id: number;
  name: string;
  color: string;
  position: number;
  pipeline_id: number;
}

export interface Lead {
  id: number;
  name: string;
  username: string;
  status: string;
  last_msg: string;
  profile_pic: string;
  value: number;
  last_interaction: string;
  unread_count: number;
  pipeline_id: number;
  created_at: string;
  thread_id?: string;
}

export interface User {
  id: number;
  username: string;
  role: 'admin' | 'tier1' | 'tier2';
  meta_token: string | null;
  ig_page_id: string | null;
  pipeline_id: number;
}

export interface Activity {
  id: number;
  user_id: number;
  description: string;
  details: string;
  created_at: string;
  pipeline_id: number;
}

export interface Appointment {
  id: number;
  patient_name: string;
  doctor_name: string;
  date_str: string;
  time_str: string;
  notes: string;
  color: string;
  pipeline_id: number;
  procedure: string;
  duration: number;
}

export interface Doctor {
  id: number;
  name: string;
  visible: number;
}

export interface Budget {
  id: number;
  patient_name: string;
  cpf: string;
  phone: string;
  procedure: string;
  amount: number;
  status: 'PENDENTE' | 'APROVADO' | 'RECUSADO';
  created_at: string;
  pipeline_id: number;
}

export interface ChatThread {
  id: string;
  name: string;
  username: string;
  profile_pic: string;
  last_msg: string;
  time_ago: string;
  unread: number;
}

export interface ChatMessage {
  id: string;
  text: string;
  from_me: boolean;
  timestamp: string;
}

export interface Notification {
  id: number;
  text: string;
  time: string;
  read: boolean;
}
