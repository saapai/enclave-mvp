'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2, Sparkles } from 'lucide-react'

interface AIResponseProps {
  query: string
  context: string
  type?: 'summary' | 'response'
  initialResponse?: string
}

export function AIResponse({ query, context, type = 'summary', initialResponse }: AIResponseProps) {
  const [response, setResponse] = useState<string>(initialResponse || '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>('')

  // Auto-generate AI response when component mounts
  useEffect(() => {
    if (query && context && !response && !loading && !error) {
      handleGetAIResponse()
    }
  }, [query, context])

  const handleGetAIResponse = async () => {
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          context,
          type,
        }),
      })

      if (!res.ok) {
        throw new Error('Failed to get AI response')
      }

      const data = await res.json()
      setResponse(data.response)
    } catch (err) {
      setError('Failed to get AI response. Please try again.')
      console.error('AI response error:', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-panel border border-line rounded-xl p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-[rgba(59,130,246,0.15)] text-blue-400 rounded-full flex items-center justify-center">
          <Sparkles className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-primary tracking-tight">AI Assistant</h3>
          <p className="text-xs text-muted">Powered by Mistral AI</p>
        </div>
      </div>
      
      {!response && !loading && !error && (
        <div className="space-y-4">
          <p className="text-muted leading-relaxed">
            Generating AI-powered summary based on the search results...
          </p>
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-3 text-muted">
          <div className="w-6 h-6 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin" />
          <span>AI is analyzing the results...</span>
        </div>
      )}

      {error && (
        <div className="text-red-300 text-sm bg-red-900/20 p-4 rounded-lg border border-red-500/30">
          {error}
        </div>
      )}

      {response && (
        <div className="space-y-4">
          <div className="bg-panel-2 p-5 rounded-lg border border-line">
            <p className="text-primary/90 leading-relaxed">{response}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleGetAIResponse}
            disabled={loading}
          >
            <Sparkles className="mr-2 h-3 w-3" />
            Regenerate
          </Button>
        </div>
      )}
    </div>
  )
}
