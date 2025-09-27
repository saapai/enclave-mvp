'use client'

import { useState } from 'react'
import { useUser } from '@clerk/nextjs'
import { Search, Plus, Filter, Clock, MapPin, Calendar, ExternalLink, Sparkles, MessageSquare, Hash, Users, Settings, Menu, X, DollarSign, FileText, Send } from 'lucide-react'
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
import { PromptCard } from '@/components/prompt-card'

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
    <div className="min-h-screen bg-surface text-primary flex flex-col">
      {/* Header */}
      <header className="border-b border-line bg-[rgba(11,12,14,0.8)] backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-4">
              <div className="w-8 h-8 bg-[rgba(59,130,246,0.15)] text-blue-400 rounded-lg flex items-center justify-center">
                <span className="font-bold text-sm">E</span>
              </div>
              <h1 className="text-lg font-semibold text-primary tracking-tight">Enclave</h1>
            </div>
            <div className="flex items-center space-x-4">
              <Button
                variant="secondary"
                onClick={() => setShowUpload(true)}
              >
                <Plus className="h-4 w-4" />
                Add Resource
              </Button>
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-panel rounded-full flex items-center justify-center text-primary text-sm font-medium">
                  {user?.firstName?.[0]}{user?.lastName?.[0]}
                </div>
                <div className="hidden sm:block">
                  <p className="text-sm font-medium text-primary">
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
            <div className="max-w-3xl mx-auto text-center">
              <h2 className="hero-title text-primary mb-4">
                Hello there!
              </h2>
              <p className="hero-subtitle mb-4">
                How can I help you today?
              </p>

              {/* Visual separator */}
              <div className="h-0.5 w-12 mx-auto rounded-full bg-gradient-to-r from-blue-500 to-red-500 opacity-80 mb-16"></div>

              {/* Suggested Prompts */}
              <div className="grid gap-4 md:grid-cols-2 mb-16">
                <PromptCard
                  icon={<Calendar className="w-5 h-5" />}
                  onClick={() => setQuery("When is the next formal event?")}
                >
                  When is the next formal event?
                </PromptCard>
                <PromptCard
                  icon={<DollarSign className="w-5 h-5" />}
                  onClick={() => setQuery("How do I pay my chapter dues?")}
                >
                  How do I pay my chapter dues?
                </PromptCard>
                <PromptCard
                  icon={<Users className="w-5 h-5" />}
                  onClick={() => setQuery("What rush events are happening this week?")}
                >
                  What rush events are happening this week?
                </PromptCard>
                <PromptCard
                  icon={<FileText className="w-5 h-5" />}
                  onClick={() => setQuery("Where can I find the chapter bylaws?")}
                >
                  Where can I find the chapter bylaws?
                </PromptCard>
              </div>
            </div>
          </div>
        )}

        {/* Bottom Input Area */}
        <div className="border-t border-line bg-surface p-4">
          <div className="max-w-4xl mx-auto">
            <div className="relative">
              <div className="rounded-2xl border border-line bg-panel flex items-center gap-2 px-3">
                <Input
                  type="text"
                  placeholder="Ask about dues, events, or upload a resource..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyPress={handleKeyPress}
                  className="flex-1 border-0 bg-transparent text-primary placeholder:text-subtle focus:ring-0 focus:outline-none"
                />
                        <Button
                          variant="primary"
                          onClick={handleSearch}
                          disabled={loading || !query.trim()}
                        >
                          {loading ? (
                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          ) : (
                            <Send className="h-4 w-4" />
                          )}
                        </Button>
              </div>
            </div>
            
            {/* Bottom Bar */}
            <div className="flex items-center justify-between mt-3 text-xs text-subtle">
              <div className="flex items-center space-x-1">
                <span>Powered by Mistral AI</span>
                <Sparkles className="h-3 w-3" />
              </div>
              <div className="text-subtle">
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