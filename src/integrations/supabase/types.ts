export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      admin_allowlist: {
        Row: {
          created_at: string
          email: string
          note: string | null
        }
        Insert: {
          created_at?: string
          email: string
          note?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          note?: string | null
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          actor_email: string | null
          actor_kind: string
          actor_user_id: string | null
          details: Json
          device_id: string | null
          entity: string | null
          entity_id: string | null
          id: number
          occurred_at: string
          outcome: string
          phi_accessed: boolean
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_kind?: string
          actor_user_id?: string | null
          details?: Json
          device_id?: string | null
          entity?: string | null
          entity_id?: string | null
          id?: number
          occurred_at?: string
          outcome?: string
          phi_accessed?: boolean
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_kind?: string
          actor_user_id?: string | null
          details?: Json
          device_id?: string | null
          entity?: string | null
          entity_id?: string | null
          id?: number
          occurred_at?: string
          outcome?: string
          phi_accessed?: boolean
        }
        Relationships: []
      }
      break_glass_events: {
        Row: {
          ended_at: string | null
          expires_at: string
          id: string
          reason: string
          started_at: string
          user_id: string
        }
        Insert: {
          ended_at?: string | null
          expires_at?: string
          id?: string
          reason: string
          started_at?: string
          user_id: string
        }
        Update: {
          ended_at?: string | null
          expires_at?: string
          id?: string
          reason?: string
          started_at?: string
          user_id?: string
        }
        Relationships: []
      }
      calls: {
        Row: {
          answered_at: string | null
          created_at: string
          device_id: string | null
          doctor_id: string
          ended_at: string | null
          hospital: string | null
          id: string
          nurse_id: string | null
          patient_room: string | null
          reason: string | null
          status: string
          unit: string | null
        }
        Insert: {
          answered_at?: string | null
          created_at?: string
          device_id?: string | null
          doctor_id: string
          ended_at?: string | null
          hospital?: string | null
          id?: string
          nurse_id?: string | null
          patient_room?: string | null
          reason?: string | null
          status?: string
          unit?: string | null
        }
        Update: {
          answered_at?: string | null
          created_at?: string
          device_id?: string | null
          doctor_id?: string
          ended_at?: string | null
          hospital?: string | null
          id?: string
          nurse_id?: string | null
          patient_room?: string | null
          reason?: string | null
          status?: string
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "calls_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      devices: {
        Row: {
          created_at: string
          id: string
          label: string
          last_seen: string | null
          site_id: string
          status: string
          token_hash: string
        }
        Insert: {
          created_at?: string
          id?: string
          label?: string
          last_seen?: string | null
          site_id: string
          status?: string
          token_hash: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          last_seen?: string | null
          site_id?: string
          status?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "devices_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "hospital_sites"
            referencedColumns: ["id"]
          },
        ]
      }
      doctor_assignments: {
        Row: {
          created_at: string
          doctor_id: string
          id: string
          is_active: boolean
          site_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          doctor_id: string
          id?: string
          is_active?: boolean
          site_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          doctor_id?: string
          id?: string
          is_active?: boolean
          site_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "doctor_assignments_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "hospital_sites"
            referencedColumns: ["id"]
          },
        ]
      }
      doctor_presence: {
        Row: {
          in_consult: boolean
          is_online: boolean
          last_seen: string
          ready_to_round: boolean
          user_id: string
        }
        Insert: {
          in_consult?: boolean
          is_online?: boolean
          last_seen?: string
          ready_to_round?: boolean
          user_id: string
        }
        Update: {
          in_consult?: boolean
          is_online?: boolean
          last_seen?: string
          ready_to_round?: boolean
          user_id?: string
        }
        Relationships: []
      }
      enrollment_codes: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          device_id: string | null
          expires_at: string
          id: string
          site_id: string
          used_at: string | null
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          device_id?: string | null
          expires_at?: string
          id?: string
          site_id: string
          used_at?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          device_id?: string | null
          expires_at?: string
          id?: string
          site_id?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "enrollment_codes_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollment_codes_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "hospital_sites"
            referencedColumns: ["id"]
          },
        ]
      }
      hospital_sites: {
        Row: {
          created_at: string
          hospital: string
          id: string
          is_active: boolean
          unit: string
        }
        Insert: {
          created_at?: string
          hospital: string
          id?: string
          is_active?: boolean
          unit: string
        }
        Update: {
          created_at?: string
          hospital?: string
          id?: string
          is_active?: boolean
          unit?: string
        }
        Relationships: []
      }
      permissions: {
        Row: {
          category: string
          created_at: string
          key: string
          label: string
          sort_order: number
        }
        Insert: {
          category?: string
          created_at?: string
          key: string
          label: string
          sort_order?: number
        }
        Update: {
          category?: string
          created_at?: string
          key?: string
          label?: string
          sort_order?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string
          hospital: string
          id: string
          specialty: string | null
          unit: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          full_name?: string
          hospital?: string
          id: string
          specialty?: string | null
          unit?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          full_name?: string
          hospital?: string
          id?: string
          specialty?: string | null
          unit?: string
          updated_at?: string
        }
        Relationships: []
      }
      role_permissions: {
        Row: {
          created_at: string
          permission_key: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          created_at?: string
          permission_key: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          created_at?: string
          permission_key?: string
          role?: Database["public"]["Enums"]["app_role"]
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_key_fkey"
            columns: ["permission_key"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["key"]
          },
        ]
      }
      rounding_queue: {
        Row: {
          cleared_at: string | null
          cleared_by: string | null
          created_at: string
          device_id: string | null
          hospital: string
          id: string
          note: string | null
          room: string
          site_id: string | null
          status: string
          unit: string
          updated_at: string
        }
        Insert: {
          cleared_at?: string | null
          cleared_by?: string | null
          created_at?: string
          device_id?: string | null
          hospital: string
          id?: string
          note?: string | null
          room: string
          site_id?: string | null
          status?: string
          unit: string
          updated_at?: string
        }
        Update: {
          cleared_at?: string | null
          cleared_by?: string | null
          created_at?: string
          device_id?: string | null
          hospital?: string
          id?: string
          note?: string | null
          room?: string
          site_id?: string | null
          status?: string
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rounding_queue_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rounding_queue_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "hospital_sites"
            referencedColumns: ["id"]
          },
        ]
      }
      tech_allowlist: {
        Row: {
          created_at: string
          email: string
          note: string | null
        }
        Insert: {
          created_at?: string
          email: string
          note?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          note?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_preview_device: {
        Args: { _site_id: string }
        Returns: {
          device_token: string
          hospital: string
          unit: string
        }[]
      }
      audit_trail: {
        Args: {
          _actor?: string
          _entity?: string
          _limit?: number
          _phi_only?: boolean
          _since?: string
        }
        Returns: {
          action: string
          actor_email: string | null
          actor_kind: string
          actor_user_id: string | null
          details: Json
          device_id: string | null
          entity: string | null
          entity_id: string | null
          id: number
          occurred_at: string
          outcome: string
          phi_accessed: boolean
        }[]
        SetofOptions: {
          from: "*"
          to: "audit_log"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      available_physicians: {
        Args: never
        Returns: {
          full_name: string
          id: string
          in_consult: boolean
          is_online: boolean
          specialty: string
        }[]
      }
      break_glass_active: { Args: { _user_id?: string }; Returns: boolean }
      claim_admin_role: { Args: never; Returns: boolean }
      claim_staff_role: { Args: { _role: string }; Returns: boolean }
      clear_rounding: {
        Args: { _device_token: string; _id: string }
        Returns: undefined
      }
      consult_analytics: {
        Args: { _bucket?: string; _since?: string }
        Returns: {
          consults: number
          period: string
          specialty: string
          total_seconds: number
        }[]
      }
      create_enrollment_code: { Args: { _site_id: string }; Returns: string }
      device_context: {
        Args: { _device_token: string }
        Returns: {
          device_id: string
          hospital: string
          label: string
          unit: string
        }[]
      }
      device_from_token: {
        Args: { _token: string }
        Returns: {
          created_at: string
          id: string
          label: string
          last_seen: string | null
          site_id: string
          status: string
          token_hash: string
        }
        SetofOptions: {
          from: "*"
          to: "devices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      device_rounding: {
        Args: { _device_token: string }
        Returns: {
          created_at: string
          id: string
          note: string
          room: string
          status: string
        }[]
      }
      end_break_glass: { Args: never; Returns: undefined }
      end_public_call: {
        Args: { _call_id: string; _device_token: string }
        Returns: undefined
      }
      get_public_call: {
        Args: { _call_id: string; _device_token: string }
        Returns: {
          doctor_id: string
          id: string
          patient_room: string
          reason: string
          status: string
        }[]
      }
      has_permission: {
        Args: { _key: string; _user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      is_staff: { Args: { _user_id: string }; Returns: boolean }
      is_super_admin: { Args: { _user_id: string }; Returns: boolean }
      is_tech: { Args: { _user_id: string }; Returns: boolean }
      log_audit_event: {
        Args: {
          _action: string
          _details?: Json
          _device_token?: string
          _entity?: string
          _entity_id?: string
          _outcome?: string
          _phi_accessed?: boolean
        }
        Returns: number
      }
      mark_rounding_ready: {
        Args: { _device_token: string; _note?: string; _room: string }
        Returns: string
      }
      my_permissions: {
        Args: never
        Returns: {
          permission_key: string
        }[]
      }
      on_call_directory: {
        Args: { _device_token: string }
        Returns: {
          full_name: string
          id: string
          in_consult: boolean
          is_online: boolean
          last_seen: string
          ready_to_round: boolean
          specialty: string
        }[]
      }
      place_public_call: {
        Args: {
          _device_token: string
          _doctor_id: string
          _patient_room: string
          _reason?: string
        }
        Returns: string
      }
      redeem_enrollment_code: {
        Args: { _code: string; _label?: string }
        Returns: {
          device_token: string
          hospital: string
          label: string
          unit: string
        }[]
      }
      start_break_glass: {
        Args: { _reason: string }
        Returns: {
          ended_at: string | null
          expires_at: string
          id: string
          reason: string
          started_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "break_glass_events"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      app_role:
        | "doctor"
        | "nurse"
        | "admin"
        | "hospital"
        | "patient"
        | "tech"
        | "analytics"
        | "system_admin"
        | "super_admin"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "doctor",
        "nurse",
        "admin",
        "hospital",
        "patient",
        "tech",
        "analytics",
        "system_admin",
        "super_admin",
      ],
    },
  },
} as const
