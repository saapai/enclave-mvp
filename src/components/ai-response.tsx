'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2, Sparkles } from 'lucide-react'

interface AIResponseProps {
  query: string
  context: string
  type?: 'summary' | 'response'
}

export function AIResponse({ query, context, type = 'summary' }: AIResponseProps) {
  const [response, setResponse] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>('')

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
    <Card className="mt-4 border-orange-600/30 bg-orange-600/5">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-orange-300">
          <Sparkles className="h-4 w-4" />
          AI Assistant
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!response && !loading && !error && (
          <div className="space-y-3">
            <p className="text-sm text-amber-200/80">
              Get an AI-powered summary or answer based on the search results.
            </p>
            <Button 
              onClick={handleGetAIResponse}
              disabled={loading}
              className="bg-orange-600 hover:bg-orange-700 text-white border-0"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Get AI {type === 'summary' ? 'Summary' : 'Answer'}
                </>
              )}
            </Button>
          </div>
        )}

        {loading && (
          <div className="flex items-center gap-2 text-orange-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Generating AI response...</span>
          </div>
        )}

        {error && (
          <div className="text-red-400 text-sm">
            {error}
          </div>
        )}

        {response && (
          <div className="space-y-3">
            <div className="prose prose-sm max-w-none">
              <p className="text-amber-100 leading-relaxed">{response}</p>
            </div>
            <Button 
              variant="outline" 
              size="sm"
              onClick={handleGetAIResponse}
              disabled={loading}
              className="border-orange-600/30 text-amber-200 hover:bg-orange-600/10"
            >
              Regenerate
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
