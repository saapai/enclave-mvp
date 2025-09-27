'use client'

import { useState } from 'react'
import { useUser } from '@clerk/nextjs'
import { Search, Plus, Filter, Clock, MapPin, Calendar, ExternalLink, Sparkles, MessageSquare, Hash, Users, Settings, Menu, X } from 'lucide-react'
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
  const [sidebarOpen, setSidebarOpen] = useState(false)

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
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary"></div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl font-bold">Welcome to Enclave</CardTitle>
            <CardDescription>
              The answer layer for your chapter. Please sign in to continue.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" onClick={() => window.location.href = '/sign-in'}>
              Sign In
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100">
      {/* Sidebar */}
      <div className={`${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} fixed inset-y-0 left-0 z-50 w-64 bg-zinc-900 border-r border-zinc-800 transition-transform duration-300 ease-in-out lg:translate-x-0 lg:static lg:inset-0`}>
        <div className="flex items-center justify-between h-16 px-4 border-b border-zinc-800">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-white">Enclave</h1>
              <p className="text-xs text-zinc-400">Chapter Knowledge</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden text-zinc-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
        
        <div className="p-4 space-y-2">
          <div className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-3">
            Quick Access
          </div>
          <Button variant="ghost" className="w-full justify-start text-zinc-300 hover:text-white hover:bg-zinc-800">
            <Hash className="w-4 h-4 mr-3" />
            All Resources
          </Button>
          <Button variant="ghost" className="w-full justify-start text-zinc-300 hover:text-white hover:bg-zinc-800">
            <Calendar className="w-4 h-4 mr-3" />
            Events
          </Button>
          <Button variant="ghost" className="w-full justify-start text-zinc-300 hover:text-white hover:bg-zinc-800">
            <Users className="w-4 h-4 mr-3" />
            Forms & Docs
          </Button>
          <Button variant="ghost" className="w-full justify-start text-zinc-300 hover:text-white hover:bg-zinc-800">
            <MessageSquare className="w-4 h-4 mr-3" />
            FAQs
          </Button>
        </div>
        
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-zinc-800">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-gradient-to-br from-green-500 to-blue-500 rounded-full flex items-center justify-center text-white text-sm font-medium">
              {user?.firstName?.[0]}{user?.lastName?.[0]}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">
                {user?.firstName} {user?.lastName}
              </p>
              <p className="text-xs text-zinc-400 truncate">
                {user?.emailAddresses[0]?.emailAddress}
              </p>
            </div>
            <Button variant="ghost" size="sm" className="text-zinc-400 hover:text-white">
              <Settings className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Header */}
        <header className="h-16 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between px-4">
          <div className="flex items-center space-x-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden text-zinc-400 hover:text-white"
            >
              <Menu className="w-4 h-4" />
            </Button>
            <div>
              <h2 className="text-lg font-semibold text-white">Search Knowledge Base</h2>
              <p className="text-sm text-zinc-400">Find answers instantly across all chapter resources</p>
            </div>
          </div>
          <Button
            onClick={() => setShowUpload(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Resource
          </Button>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 overflow-y-auto bg-zinc-950">
          <div className="max-w-4xl mx-auto p-6">
            {/* Search Section */}
            <div className="mb-8">
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <Search className="h-5 w-5 text-zinc-400" />
                </div>
                <Input
                  type="text"
                  placeholder="Ask anything about your chapter... (e.g., 'When is the next formal?' or 'How do I pay dues?')"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyPress={handleKeyPress}
                  className="pl-12 pr-24 py-4 text-base bg-zinc-900 border-zinc-700 focus:border-blue-500 focus:ring-blue-500/20 rounded-xl text-white placeholder-zinc-400 shadow-lg"
                />
                <div className="absolute inset-y-0 right-0 flex items-center pr-2">
                  <Button
                    onClick={handleSearch}
                    disabled={loading || !query.trim()}
                    size="sm"
                    className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
                  >
                    {loading ? (
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <Sparkles className="w-4 h-4" />
                    )}
                  </Button>
                </div>
              </div>

              {/* Quick Filters */}
              <div className="mt-4 flex flex-wrap gap-2">
                <Badge 
                  variant={!filters.type ? "default" : "secondary"} 
                  className="cursor-pointer hover:bg-zinc-700"
                  onClick={() => setFilters({ ...filters, type: undefined })}
                >
                  All
                </Badge>
                <Badge 
                  variant={filters.type === 'event' ? "default" : "secondary"} 
                  className="cursor-pointer hover:bg-zinc-700"
                  onClick={() => setFilters({ ...filters, type: 'event' })}
                >
                  <Calendar className="w-3 h-3 mr-1" />
                  Events
                </Badge>
                <Badge 
                  variant={filters.type === 'form' ? "default" : "secondary"} 
                  className="cursor-pointer hover:bg-zinc-700"
                  onClick={() => setFilters({ ...filters, type: 'form' })}
                >
                  Forms
                </Badge>
                <Badge 
                  variant={filters.type === 'doc' ? "default" : "secondary"} 
                  className="cursor-pointer hover:bg-zinc-700"
                  onClick={() => setFilters({ ...filters, type: 'doc' })}
                >
                  Documents
                </Badge>
                <Badge 
                  variant={filters.type === 'faq' ? "default" : "secondary"} 
                  className="cursor-pointer hover:bg-zinc-700"
                  onClick={() => setFilters({ ...filters, type: 'faq' })}
                >
                  <MessageSquare className="w-3 h-3 mr-1" />
                  FAQs
                </Badge>
              </div>
            </div>

            {/* Results Section */}
            <div className="space-y-6">
              {results.length > 0 ? (
                <>
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-zinc-400">
                      Found {results.length} result{results.length !== 1 ? 's' : ''}
                    </div>
                  </div>
                  
                  {/* AI Response Component */}
                  <AIResponse 
                    query={query}
                    context={results.map(r => `${r.title}: ${r.body || ''}`).join('\n\n')}
                    type="summary"
                  />
                  
                  {/* Results */}
                  <div className="space-y-4">
                    {results.map((resource) => (
                      <Card key={resource.id} className="bg-zinc-900 border-zinc-700 hover:border-zinc-600 transition-colors">
                        <CardContent className="p-6">
                          <div className="flex items-start justify-between mb-4">
                            <div className="flex-1">
                              <div className="flex items-center space-x-2 mb-2">
                                <Badge variant="secondary" className="bg-zinc-800 text-zinc-300 text-xs">
                                  {resource.type}
                                </Badge>
                                {resource.tags?.slice(0, 2).map((tag) => (
                                  <Badge key={tag.id} variant="outline" className="border-zinc-600 text-zinc-400 text-xs">
                                    {tag.name}
                                  </Badge>
                                ))}
                              </div>
                              <h3 className="text-lg font-semibold text-white mb-2">{resource.title}</h3>
                              <p className="text-zinc-300 text-sm leading-relaxed">
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
                                className="text-zinc-400 hover:text-white hover:bg-zinc-800"
                              >
                                <ExternalLink className="h-4 w-4" />
                              </Button>
                            )}
                          </div>

                          {/* Event-specific information */}
                          {resource.type === 'event' && resource.event_meta && (
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-zinc-400 mb-4 p-4 bg-zinc-800 rounded-lg">
                              {resource.event_meta.start_at && (
                                <div className="flex items-center">
                                  <Calendar className="h-4 w-4 mr-2 text-blue-400" />
                                  <span>{formatDate(resource.event_meta.start_at)} at {formatTime(resource.event_meta.start_at)}</span>
                                </div>
                              )}
                              {resource.event_meta.location && (
                                <div className="flex items-center">
                                  <MapPin className="h-4 w-4 mr-2 text-green-400" />
                                  <span>{resource.event_meta.location}</span>
                                </div>
                              )}
                              {resource.event_meta.cost && (
                                <div className="flex items-center">
                                  <Clock className="h-4 w-4 mr-2 text-yellow-400" />
                                  <span>{resource.event_meta.cost}</span>
                                </div>
                              )}
                            </div>
                          )}

                          <div className="text-xs text-zinc-500 flex items-center justify-between">
                            <span>Updated {formatDate(resource.updated_at)} • Source: {resource.source}</span>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </>
              ) : query ? (
                <div className="text-center py-16">
                  <div className="w-16 h-16 bg-zinc-800 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Search className="w-8 h-8 text-zinc-400" />
                  </div>
                  <h3 className="text-lg font-medium text-white mb-2">No results found</h3>
                  <p className="text-zinc-400 mb-6">We couldn't find anything matching "{query}"</p>
                  <Button
                    onClick={() => setShowUpload(true)}
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add this information
                  </Button>
                </div>
              ) : (
                <div className="text-center py-16">
                  <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Sparkles className="w-8 h-8 text-white" />
                  </div>
                  <h3 className="text-xl font-semibold text-white mb-2">Welcome to Enclave</h3>
                  <p className="text-zinc-400 mb-6 max-w-md mx-auto">
                    Your chapter's knowledge base. Ask anything about events, forms, documents, and more.
                  </p>
                  <div className="flex flex-wrap gap-2 justify-center">
                    <Badge variant="secondary" className="bg-zinc-800 text-zinc-300">
                      "When is the next formal?"
                    </Badge>
                    <Badge variant="secondary" className="bg-zinc-800 text-zinc-300">
                      "How do I pay dues?"
                    </Badge>
                    <Badge variant="secondary" className="bg-zinc-800 text-zinc-300">
                      "Rush events this week"
                    </Badge>
                  </div>
                </div>
              )}
            </div>
          </div>
        </main>
      </div>

      {/* Upload Dialog */}
      <UploadDialog open={showUpload} onOpenChange={setShowUpload} />
    </div>
  )
}