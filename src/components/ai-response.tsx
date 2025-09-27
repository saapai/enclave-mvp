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
    <Card className="bg-gradient-to-r from-blue-900/20 to-purple-900/20 border-blue-500/20 backdrop-blur-sm">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-blue-300">
          <div className="w-6 h-6 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
            <Sparkles className="h-3 w-3 text-white" />
          </div>
          AI Assistant
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!response && !loading && !error && (
          <div className="space-y-4">
            <p className="text-sm text-zinc-300">
              Get an AI-powered summary based on the search results above.
            </p>
            <Button
              onClick={handleGetAIResponse}
              disabled={loading}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Generate AI {type === 'summary' ? 'Summary' : 'Answer'}
                </>
              )}
            </Button>
          </div>
        )}

        {loading && (
          <div className="flex items-center gap-3 text-blue-300">
            <div className="w-6 h-6 border-2 border-blue-300/30 border-t-blue-300 rounded-full animate-spin" />
            <span>AI is analyzing the results...</span>
          </div>
        )}

        {error && (
          <div className="text-red-400 text-sm bg-red-900/20 p-3 rounded-lg border border-red-500/20">
            {error}
          </div>
        )}

        {response && (
          <div className="space-y-4">
            <div className="bg-zinc-900/50 p-4 rounded-lg border border-zinc-700">
              <p className="text-zinc-100 leading-relaxed text-sm">{response}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleGetAIResponse}
              disabled={loading}
              className="border-zinc-600 text-zinc-300 hover:text-white hover:bg-zinc-800"
            >
              <Sparkles className="mr-2 h-3 w-3" />
              Regenerate
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
