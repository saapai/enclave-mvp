'use client'

import { useState } from 'react'
import { useUser } from '@clerk/nextjs'
import { Search, Plus, Filter, Clock, MapPin, Calendar, ExternalLink, Sparkles, MessageSquare, Hash, Users, Settings, Menu, X, Paperclip, Mic } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SearchFilters, searchResources, logQuery } from '@/lib/search'
import { ResourceWithTags } from '@/lib/database.types'
import { UploadDialog } from '@/components/upload-dialog'
import { AIResponse } from '@/components/ai-response'

export default function HomePage() {
  const { user, isLoaded } = useUser()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ResourceWithTags[]>([])
  const [loading, setLoading] = useState(false)
  const [filters, setFilters] = useState<SearchFilters>({})
  const [showUpload, setShowUpload] = useState(false)

  const handleSearch = async () => {
    if (!query.trim() || !user) return

    setLoading(true)
    try {
      const searchResults = await searchResources(query, '00000000-0000-0000-0000-000000000000', filters)
      setResults(searchResults)
      
      // Log the query
      await logQuery('00000000-0000-0000-0000-000000000000', user.id, query, searchResults.length)
    } catch (error) {
      console.error('Search error:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch()
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
  }

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    })
  }

  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-white"></div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <Card className="w-full max-w-md bg-gray-900 border-gray-700">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl font-bold text-white">Welcome to Enclave</CardTitle>
            <CardDescription className="text-gray-400">
              The answer layer for your chapter. Please sign in to continue.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full bg-white text-black hover:bg-gray-200" onClick={() => window.location.href = '/sign-in'}>
              Sign In
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-800 bg-black">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-4">
              <div className="w-8 h-8 bg-white rounded flex items-center justify-center">
                <span className="text-black font-bold text-sm">E</span>
              </div>
              <h1 className="text-lg font-semibold text-white">Enclave</h1>
            </div>
            <div className="flex items-center space-x-4">
              <Button
                onClick={() => setShowUpload(true)}
                variant="outline"
                className="border-gray-600 text-white hover:bg-gray-800"
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Resource
              </Button>
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-gray-600 rounded-full flex items-center justify-center text-white text-sm font-medium">
                  {user?.firstName?.[0]}{user?.lastName?.[0]}
                </div>
                <div className="hidden sm:block">
                  <p className="text-sm font-medium text-white">
                    {user?.firstName} {user?.lastName}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col">
        {results.length > 0 ? (
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-4xl mx-auto px-4 py-8">
              {/* AI Response Component */}
              <AIResponse 
                query={query}
                context={results.map(r => `${r.title}: ${r.body || ''}`).join('\n\n')}
                type="summary"
              />
              
              {/* Results */}
              <div className="space-y-4 mt-6">
                {results.map((resource) => (
                  <Card key={resource.id} className="bg-gray-900 border-gray-700">
                    <CardContent className="p-6">
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex-1">
                          <div className="flex items-center space-x-2 mb-3">
                            <Badge variant="secondary" className="bg-gray-700 text-gray-300 text-xs">
                              {resource.type}
                            </Badge>
                            {resource.tags?.slice(0, 2).map((tag) => (
                              <Badge key={tag.id} variant="outline" className="border-gray-600 text-gray-400 text-xs">
                                {tag.name}
                              </Badge>
                            ))}
                          </div>
                          <h3 className="text-lg font-semibold text-white mb-2">{resource.title}</h3>
                          <p className="text-gray-300 text-sm leading-relaxed">
                            {resource.body && resource.body.length > 200
                              ? `${resource.body.substring(0, 200)}...`
                              : resource.body}
                          </p>
                        </div>
                        {resource.url && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => resource.url && window.open(resource.url, '_blank')}
                            className="text-gray-400 hover:text-white hover:bg-gray-800"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                        )}
                      </div>

                      {/* Event-specific information */}
                      {resource.type === 'event' && resource.event_meta && (
                        <div className="space-y-2 mb-4 p-3 bg-gray-800 rounded-lg">
                          {resource.event_meta.start_at && (
                            <div className="flex items-center text-sm text-gray-300">
                              <Calendar className="h-4 w-4 mr-2 text-blue-400" />
                              <span>{formatDate(resource.event_meta.start_at)} at {formatTime(resource.event_meta.start_at)}</span>
                            </div>
                          )}
                          {resource.event_meta.location && (
                            <div className="flex items-center text-sm text-gray-300">
                              <MapPin className="h-4 w-4 mr-2 text-green-400" />
                              <span>{resource.event_meta.location}</span>
                            </div>
                          )}
                          {resource.event_meta.cost && (
                            <div className="flex items-center text-sm text-gray-300">
                              <Clock className="h-4 w-4 mr-2 text-yellow-400" />
                              <span>{resource.event_meta.cost}</span>
                            </div>
                          )}
                        </div>
                      )}

                      <div className="text-xs text-gray-500 flex items-center justify-between">
                        <span>Updated {formatDate(resource.updated_at)}</span>
                        <span>• {resource.source}</span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center px-4">
            <div className="max-w-2xl mx-auto text-center">
              <h2 className="text-4xl font-bold text-white mb-4">
                Hello there!
              </h2>
              <p className="text-xl text-gray-400 mb-12">
                How can I help you today?
              </p>

              {/* Suggested Prompts */}
              <div className="grid gap-4 md:grid-cols-2 mb-12">
                <Card 
                  className="bg-gray-900 border-gray-700 hover:bg-gray-800 cursor-pointer transition-colors"
                  onClick={() => setQuery("When is the next formal event?")}
                >
                  <CardContent className="p-4">
                    <p className="text-white text-left">When is the next formal event?</p>
                  </CardContent>
                </Card>
                <Card 
                  className="bg-gray-900 border-gray-700 hover:bg-gray-800 cursor-pointer transition-colors"
                  onClick={() => setQuery("How do I pay my chapter dues?")}
                >
                  <CardContent className="p-4">
                    <p className="text-white text-left">How do I pay my chapter dues?</p>
                  </CardContent>
                </Card>
                <Card 
                  className="bg-gray-900 border-gray-700 hover:bg-gray-800 cursor-pointer transition-colors"
                  onClick={() => setQuery("What rush events are happening this week?")}
                >
                  <CardContent className="p-4">
                    <p className="text-white text-left">What rush events are happening this week?</p>
                  </CardContent>
                </Card>
                <Card 
                  className="bg-gray-900 border-gray-700 hover:bg-gray-800 cursor-pointer transition-colors"
                  onClick={() => setQuery("Where can I find the chapter bylaws?")}
                >
                  <CardContent className="p-4">
                    <p className="text-white text-left">Where can I find the chapter bylaws?</p>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        )}

        {/* Bottom Input Area */}
        <div className="border-t border-gray-800 bg-black p-4">
          <div className="max-w-4xl mx-auto">
            <div className="relative">
              <Input
                type="text"
                placeholder="Send a message..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyPress={handleKeyPress}
                className="w-full pr-20 pl-4 py-3 bg-gray-900 border-gray-700 text-white placeholder-gray-400 rounded-lg focus:border-gray-600 focus:ring-0"
              />
              <div className="absolute right-2 top-1/2 transform -translate-y-1/2 flex items-center space-x-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-gray-400 hover:text-white hover:bg-gray-800 p-2"
                >
                  <Paperclip className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-gray-400 hover:text-white hover:bg-gray-800 p-2"
                >
                  <Mic className="h-4 w-4" />
                </Button>
                <Button
                  onClick={handleSearch}
                  disabled={loading || !query.trim()}
                  size="sm"
                  className="bg-white text-black hover:bg-gray-200 p-2 rounded-full"
                >
                  {loading ? (
                    <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                  )}
                </Button>
              </div>
            </div>
            
            {/* Bottom Bar */}
            <div className="flex items-center justify-between mt-2 text-xs text-gray-500">
              <div className="flex items-center space-x-4">
                <Button variant="ghost" size="sm" className="text-gray-500 hover:text-gray-300 p-1">
                  <Paperclip className="h-3 w-3 mr-1" />
                  Attach
                </Button>
                <div className="flex items-center space-x-1">
                  <span>Mistral AI</span>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
              <div className="text-gray-500">
                Press Enter to send
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Upload Dialog */}
      <UploadDialog open={showUpload} onOpenChange={setShowUpload} />
    </div>
  )
}