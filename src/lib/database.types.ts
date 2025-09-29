export interface Database {
  public: {
    Tables: {
      space: {
        Row: {
          id: string
          name: string
          domain: string | null
          default_visibility: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          domain?: string | null
          default_visibility?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          domain?: string | null
          default_visibility?: string
          created_at?: string
          updated_at?: string
        }
      }
      app_user: {
        Row: {
          id: string
          space_id: string
          name: string | null
          email: string | null
          phone: string | null
          role: 'member' | 'curator' | 'admin'
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          space_id: string
          name?: string | null
          email?: string | null
          phone?: string | null
          role?: 'member' | 'curator' | 'admin'
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          space_id?: string
          name?: string | null
          email?: string | null
          phone?: string | null
          role?: 'member' | 'curator' | 'admin'
          created_at?: string
          updated_at?: string
        }
      }
      resource: {
        Row: {
          id: string
          space_id: string
          type: 'event' | 'doc' | 'form' | 'link' | 'faq'
          title: string
          body: string | null
          url: string | null
          source: 'upload' | 'gdoc' | 'gcal' | 'slack' | 'sms'
          visibility: string
          created_by: string
          updated_at: string
          created_at: string
        }
        Insert: {
          id?: string
          space_id: string
          type: 'event' | 'doc' | 'form' | 'link' | 'faq'
          title: string
          body?: string | null
          url?: string | null
          source?: 'upload' | 'gdoc' | 'gcal' | 'slack' | 'sms'
          visibility?: string
          created_by: string
          updated_at?: string
          created_at?: string
        }
        Update: {
          id?: string
          space_id?: string
          type?: 'event' | 'doc' | 'form' | 'link' | 'faq'
          title?: string
          body?: string | null
          url?: string | null
          source?: 'upload' | 'gdoc' | 'gcal' | 'slack' | 'sms'
          visibility?: string
          created_by?: string
          updated_at?: string
          created_at?: string
        }
      }
      tag: {
        Row: {
          id: string
          space_id: string
          name: string
          kind: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          space_id: string
          name: string
          kind?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          space_id?: string
          name?: string
          kind?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      resource_tag: {
        Row: {
          resource_id: string
          tag_id: string
          created_at: string
        }
        Insert: {
          resource_id: string
          tag_id: string
          created_at?: string
        }
        Update: {
          resource_id?: string
          tag_id?: string
          created_at?: string
        }
      }
      event_meta: {
        Row: {
          resource_id: string
          start_at: string | null
          end_at: string | null
          location: string | null
          rsvp_link: string | null
          cost: string | null
          dress_code: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          resource_id: string
          start_at?: string | null
          end_at?: string | null
          location?: string | null
          rsvp_link?: string | null
          cost?: string | null
          dress_code?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          resource_id?: string
          start_at?: string | null
          end_at?: string | null
          location?: string | null
          rsvp_link?: string | null
          cost?: string | null
          dress_code?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      query_log: {
        Row: {
          id: string
          space_id: string
          user_id: string
          text: string
          ts: string
          results_count: number | null
          clicked_resource_id: string | null
          satisfaction: 'thumbs_up' | 'thumbs_down' | null
          created_at: string
        }
        Insert: {
          id?: string
          space_id: string
          user_id: string
          text: string
          ts?: string
          results_count?: number | null
          clicked_resource_id?: string | null
          satisfaction?: 'thumbs_up' | 'thumbs_down' | null
          created_at?: string
        }
        Update: {
          id?: string
          space_id?: string
          user_id?: string
          text?: string
          ts?: string
          results_count?: number | null
          clicked_resource_id?: string | null
          satisfaction?: 'thumbs_up' | 'thumbs_down' | null
          created_at?: string
        }
      }
      gap_alert: {
        Row: {
          id: string
          space_id: string
          query_text: string
          count_last_24h: number
          status: 'open' | 'claimed' | 'resolved'
          assigned_to: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          space_id: string
          query_text: string
          count_last_24h: number
          status?: 'open' | 'claimed' | 'resolved'
          assigned_to?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          space_id?: string
          query_text?: string
          count_last_24h?: number
          status?: 'open' | 'claimed' | 'resolved'
          assigned_to?: string | null
          created_at?: string
          updated_at?: string
        }
      }
    }
  }
}

export type Space = Database['public']['Tables']['space']['Row']
export type AppUser = Database['public']['Tables']['app_user']['Row']
export type Resource = Database['public']['Tables']['resource']['Row']
export type Tag = Database['public']['Tables']['tag']['Row']
export type ResourceTag = Database['public']['Tables']['resource_tag']['Row']
export type EventMeta = Database['public']['Tables']['event_meta']['Row']
export type QueryLog = Database['public']['Tables']['query_log']['Row']
export type GapAlert = Database['public']['Tables']['gap_alert']['Row']

export type ResourceWithTags = Resource & {
  tags: Tag[]
  event_meta?: EventMeta | null
  created_by_user?: AppUser | null
}

export type SearchResult = ResourceWithTags & {
  rank: number
  score: number
}


