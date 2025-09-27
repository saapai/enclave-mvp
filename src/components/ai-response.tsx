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
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center">
          <Sparkles className="h-4 w-4 text-black" />
        </div>
        <h3 className="text-lg font-semibold text-white">AI Assistant</h3>
      </div>
      
      {!response && !loading && !error && (
        <div className="space-y-4">
          <p className="text-gray-300">
            Get an AI-powered summary based on the search results above.
          </p>
          <Button
            onClick={handleGetAIResponse}
            disabled={loading}
            className="bg-white text-black hover:bg-gray-200"
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
        <div className="flex items-center gap-3 text-gray-300">
          <div className="w-6 h-6 border-2 border-gray-300/30 border-t-gray-300 rounded-full animate-spin" />
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
          <div className="bg-gray-800 p-4 rounded-lg">
            <p className="text-gray-100 leading-relaxed">{response}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleGetAIResponse}
            disabled={loading}
            className="border-gray-600 text-gray-300 hover:text-white hover:bg-gray-800"
          >
            <Sparkles className="mr-2 h-3 w-3" />
            Regenerate
          </Button>
        </div>
      )}
    </div>
  )
}
