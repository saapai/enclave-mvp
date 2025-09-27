'use client'

import { useRef, useState } from 'react'
import { useUser } from '@clerk/nextjs'
import { Search, Plus, Filter, Clock, MapPin, Calendar, ExternalLink, Paperclip } from 'lucide-react'
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
  const [aiAnswer, setAiAnswer] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [filters, setFilters] = useState<SearchFilters>({})
  const [showUpload, setShowUpload] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [attaching, setAttaching] = useState(false)

  const handleSearch = async () => {
    if (!query.trim() || !user) return

    setLoading(true)
    try {
      const searchResults = await searchResources(query, '00000000-0000-0000-0000-000000000000', filters)
      setResults(searchResults)
      
      // Log the query
      await logQuery('00000000-0000-0000-0000-000000000000', user.id, query, searchResults.length)

      // Fetch AI answer using retrieval over uploaded files
      try {
        const res = await fetch(`/api/ask?q=${encodeURIComponent(query)}`)
        if (res.ok) {
          const data = await res.json()
          setAiAnswer(data.answer || '')
        } else {
          setAiAnswer('')
        }
      } catch (_e) {
        setAiAnswer('')
      }
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

  const handleAttachClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileAttachChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !user) return
    setAttaching(true)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('title', file.name)
      form.append('description', '')
      form.append('type', 'doc')
      form.append('url', '')
      form.append('tags', JSON.stringify([]))
      const res = await fetch('/api/upload', { method: 'POST', body: form })
      if (res.ok) {
        // Re-run search to include newly attached content
        if (query.trim()) {
          await handleSearch()
        }
      }
    } catch (err) {
      console.error('Attach upload error:', err)
    } finally {
      setAttaching(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
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
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <h1 className="text-2xl font-bold text-foreground">Enclave</h1>
              <span className="ml-2 text-sm text-muted-foreground">v0.1</span>
            </div>
            <div className="flex items-center space-x-4">
              <Button
                onClick={() => setShowUpload(true)}
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                <Plus className="h-4 w-4 mr-2" />
                Upload
              </Button>
              <div className="text-sm text-foreground">
                {user.firstName} {user.lastName}
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Search Section */}
        <div className="mb-8">
          <div className="text-center mb-8">
            <h2 className="text-3xl font-bold text-foreground mb-4">
              Find answers instantly
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Search for events, forms, documents, and more. Get the exact information you need in seconds.
            </p>
          </div>

          <div className="max-w-4xl mx-auto">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-5 w-5" />
              <Input
                type="text"
                placeholder="Search for 'semi-formal bus time' or 'dues form'..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyPress={handleKeyPress}
                className="pl-10 pr-4 py-3 text-lg bg-background border-2 border-border focus:border-ring rounded-xl text-foreground placeholder-muted-foreground"
              />
              <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileAttachChange} />
              <Button
                type="button"
                variant="outline"
                onClick={handleAttachClick}
                disabled={attaching}
                className="absolute right-36 top-1/2 transform -translate-y-1/2"
              >
                <Paperclip className="h-4 w-4 mr-2" />
                {attaching ? 'Attaching...' : 'Attach'}
              </Button>
              <Button
                onClick={handleSearch}
                disabled={loading || !query.trim()}
                className="absolute right-2 top-1/2 transform -translate-y-1/2 bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                {loading ? 'Searching...' : 'Search'}
              </Button>
            </div>

            {/* Filters */}
            <div className="mt-4 flex flex-wrap gap-4">
              <Select
                value={filters.type || 'all'}
                onValueChange={(value) => setFilters({ ...filters, type: value === 'all' ? undefined : value })}
              >
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="event">Events</SelectItem>
                  <SelectItem value="form">Forms</SelectItem>
                  <SelectItem value="doc">Documents</SelectItem>
                  <SelectItem value="link">Links</SelectItem>
                  <SelectItem value="faq">FAQs</SelectItem>
                </SelectContent>
              </Select>

              <Button
                variant="outline"
                onClick={() => setFilters({})}
              >
                <Filter className="h-4 w-4 mr-2" />
                Clear Filters
              </Button>
            </div>
          </div>
        </div>

        {/* Results Section */}
        <Tabs defaultValue="search" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="search">Search Results</TabsTrigger>
            <TabsTrigger value="requests">Requests</TabsTrigger>
          </TabsList>

          <TabsContent value="search" className="mt-6">
            {results.length > 0 ? (
              <div className="space-y-4">
                <div className="text-sm text-muted-foreground mb-4">
                  Found {results.length} result{results.length !== 1 ? 's' : ''}
                </div>
                
                {/* AI Response Component */}
                <AIResponse 
                  query={query}
                  context={results.map(r => `${r.title}: ${r.body || ''}`).join('\n\n')}
                  type="response"
                  initialResponse={aiAnswer}
                />
                {results.map((resource) => (
                  <Card key={resource.id} className="hover:shadow-md transition-shadow">
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <CardTitle className="text-lg mb-2">{resource.title}</CardTitle>
                          <CardDescription className="text-sm text-muted-foreground mb-3">
                            {resource.body && resource.body.length > 200
                              ? `${resource.body.substring(0, 200)}...`
                              : resource.body}
                          </CardDescription>
                        </div>
                        <div className="flex items-center space-x-2 ml-4">
                          <Badge variant="secondary" className="text-xs">
                            {resource.type}
                          </Badge>
                          {resource.url && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => resource.url && window.open(resource.url, '_blank')}
                            >
                              <ExternalLink className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="flex flex-wrap gap-2 mb-4">
                        {resource.tags?.map((tag) => (
                          <Badge key={tag.id} variant="outline" className="text-xs">
                            {tag.name}
                          </Badge>
                        ))}
                      </div>

                      {/* Event-specific information */}
                      {resource.type === 'event' && resource.event_meta && (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-muted-foreground">
                          {resource.event_meta.start_at && (
                            <div className="flex items-center">
                              <Calendar className="h-4 w-4 mr-2" />
                              {formatDate(resource.event_meta.start_at)} at {formatTime(resource.event_meta.start_at)}
                            </div>
                          )}
                          {resource.event_meta.location && (
                            <div className="flex items-center">
                              <MapPin className="h-4 w-4 mr-2" />
                              {resource.event_meta.location}
                            </div>
                          )}
                          {resource.event_meta.cost && (
                            <div className="flex items-center">
                              <Clock className="h-4 w-4 mr-2" />
                              {resource.event_meta.cost}
                            </div>
                          )}
                        </div>
                      )}

                      <div className="text-xs text-muted-foreground mt-4">
                        Updated {formatDate(resource.updated_at)} • Source: {resource.source}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : query ? (
              <div className="text-center py-12">
                <div className="text-muted-foreground mb-4">No results found for &quot;{query}&quot;</div>
                <Button
                  onClick={() => setShowUpload(true)}
                  variant="outline"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add this information
                </Button>
              </div>
            ) : (
              <div className="text-center py-12">
                <div className="text-muted-foreground mb-4">Start typing to search for information</div>
                <div className="text-sm text-muted-foreground">
                  Try searching for &quot;rush events&quot; or &quot;dues form&quot;
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="requests" className="mt-6">
            <div className="text-center py-12">
              <div className="text-muted-foreground mb-4">No open requests</div>
              <div className="text-sm text-muted-foreground">
                Gap alerts will appear here when people search for missing information
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </main>

      {/* Upload Dialog */}
      <UploadDialog open={showUpload} onOpenChange={setShowUpload} />
    </div>
  )
}