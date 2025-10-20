import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  try {
    // Test if Google Docs tables exist
    const tables = ['google_accounts', 'sources_google_docs', 'google_doc_chunks', 'gdrive_watches']
    const results: Record<string, boolean> = {}
    
    for (const table of tables) {
      try {
        const { error } = await supabase
          .from(table)
          .select('*')
          .limit(1)
        
        results[table] = !error
      } catch (e) {
        results[table] = false
      }
    }
    
    return NextResponse.json({
      success: true,
      tables: results,
      message: 'Run database/fix-google-docs-schema.sql in Supabase if any tables are missing'
    })
  } catch (error) {
    console.error('Database test error:', error)
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 })
  }
}





