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
    <Card className="mt-4 border-primary/20 bg-primary/5">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-primary">
          <Sparkles className="h-4 w-4" />
          AI Assistant
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!response && !loading && !error && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Get an AI-powered summary or answer based on the search results.
            </p>
            <Button 
              onClick={handleGetAIResponse}
              disabled={loading}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
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
          <div className="flex items-center gap-2 text-primary">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Generating AI response...</span>
          </div>
        )}

        {error && (
          <div className="text-destructive text-sm">
            {error}
          </div>
        )}

        {response && (
          <div className="space-y-3">
            <div className="prose prose-sm max-w-none">
              <p className="text-foreground leading-relaxed">{response}</p>
            </div>
            <Button 
              variant="outline" 
              size="sm"
              onClick={handleGetAIResponse}
              disabled={loading}
            >
              Regenerate
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
