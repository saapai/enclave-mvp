'use client'

import { useRef, useState, useEffect } from 'react'
import { useUser } from '@clerk/nextjs'
import { Search, Plus, Filter, Clock, MapPin, Calendar, ExternalLink, Sparkles, MessageSquare, Hash, Users, Settings, Menu, X, DollarSign, FileText, Send, Paperclip, Link, Loader2, RefreshCw, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { SearchFilters, searchResources, logQuery } from '@/lib/search'
import { ResourceWithTags } from '@/lib/database.types'
import { UploadDialog } from '@/components/upload-dialog'
import { AIResponse } from '@/components/ai-response'
import { PromptCard } from '@/components/prompt-card'
import { GroupsDialog } from '@/components/groups-dialog'
import { SlackDialog } from '@/components/slack-dialog'
import { CalendarDialog } from '@/components/calendar-dialog'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  results?: ResourceWithTags[]
  timestamp: Date
}

export default function HomePage() {
  const { user, isLoaded } = useUser()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ResourceWithTags[]>([])
  const [loading, setLoading] = useState(false)
  const [filters, setFilters] = useState<SearchFilters>({})
  const [showUpload, setShowUpload] = useState(false)
  const [showConnectDoc, setShowConnectDoc] = useState(false)
  const [connectingDoc, setConnectingDoc] = useState(false)
  const [docUrl, setDocUrl] = useState('')
  const [refreshingDocs, setRefreshingDocs] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [attaching, setAttaching] = useState(false)
  const [aiAnswer, setAiAnswer] = useState('')
  const [autoRefreshing, setAutoRefreshing] = useState(false)
  const [showGroups, setShowGroups] = useState(false)
  const [showSlack, setShowSlack] = useState(false)
  const [showCalendar, setShowCalendar] = useState(false)
  const [showAddMenu, setShowAddMenu] = useState(false)
  const [spaces, setSpaces] = useState<any[]>([])
  const [selectedSpaceIds, setSelectedSpaceIds] = useState<string[]>(['00000000-0000-0000-0000-000000000000'])
  const [messages, setMessages] = useState<Message[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Fetch spaces when user loads
  useEffect(() => {
    if (user) {
      fetchSpaces()
      loadConversationHistory()
    }
  }, [user])

  // Load conversation history from localStorage
  const loadConversationHistory = () => {
    try {
      const saved = localStorage.getItem(`conversation_${user?.id}`)
      if (saved) {
        const parsed = JSON.parse(saved)
        setMessages(parsed.map((m: any) => ({
          ...m,
          timestamp: new Date(m.timestamp)
        })))
      }
    } catch (error) {
      console.error('Failed to load conversation history:', error)
    }
  }

  // Save conversation history to localStorage
  const saveConversationHistory = (msgs: Message[]) => {
    try {
      localStorage.setItem(`conversation_${user?.id}`, JSON.stringify(msgs))
    } catch (error) {
      console.error('Failed to save conversation history:', error)
    }
  }

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const fetchSpaces = async () => {
    try {
      const response = await fetch('/api/spaces')
      if (response.ok) {
        const data = await response.json()
        setSpaces(data.spaces || [])
        // Set default to all spaces
        if (data.spaces && data.spaces.length > 0) {
          setSelectedSpaceIds(data.spaces.map((s: any) => s.id))
        }
      }
    } catch (error) {
      console.error('Failed to fetch spaces:', error)
    }
  }

  const toggleSpace = (spaceId: string) => {
    setSelectedSpaceIds(prev => {
      if (prev.includes(spaceId)) {
        // Don't allow deselecting all spaces
        if (prev.length > 1) {
          return prev.filter(id => id !== spaceId)
        }
        return prev
      } else {
        return [...prev, spaceId]
      }
    })
  }

  const selectAllSpaces = () => {
    setSelectedSpaceIds(spaces.map(space => space.id))
  }

  const getSelectedSpaceNames = () => {
    return selectedSpaceIds.map(id => spaces.find(s => s.id === id)?.name).filter(Boolean).join(', ')
  }

  // Auto-refresh Google Docs every 2 minutes
  useEffect(() => {
    if (!user) return

    let isActive = true

    const autoRefreshGoogleDocs = async () => {
      if (!isActive || autoRefreshing) return // Prevent overlapping refreshes
      
      setAutoRefreshing(true)
      console.log('[Auto-Refresh] Starting Google Docs auto-refresh check...')
      
      try {
        // Get list of Google Docs
        const listResponse = await fetch('/api/google/docs/list')
        if (!listResponse.ok) {
          console.log('[Auto-Refresh] Failed to fetch Google Docs list')
          return
        }
        
        const { googleDocs } = await listResponse.json()
        
        if (!googleDocs || googleDocs.length === 0) {
          console.log('[Auto-Refresh] No Google Docs found')
          return
        }
        
        console.log(`[Auto-Refresh] Found ${googleDocs.length} Google Doc(s) to check`)
        
        // Refresh each Google Doc silently in the background
        let refreshedCount = 0
        for (const doc of googleDocs) {
          if (!isActive) break
          try {
            console.log(`[Auto-Refresh] Checking doc: ${doc.title} (${doc.id})`)
            const response = await fetch('/api/google/docs/refresh', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sourceId: doc.id })
            })
            
            if (response.ok) {
              const result = await response.json()
              if (result.isModified) {
                console.log(`[Auto-Refresh] ✓ Updated: ${doc.title}`)
                refreshedCount++
              } else {
                console.log(`[Auto-Refresh] - No changes: ${doc.title}`)
              }
            }
          } catch (error) {
            console.error(`[Auto-Refresh] Failed to refresh doc ${doc.id}:`, error)
          }
        }
        
        if (refreshedCount > 0) {
          console.log(`[Auto-Refresh] Completed: ${refreshedCount} doc(s) updated`)
        } else {
          console.log('[Auto-Refresh] Completed: All docs up to date')
        }
      } catch (error) {
        console.error('[Auto-Refresh] Error:', error)
      } finally {
        if (isActive) setAutoRefreshing(false)
      }
    }

    // Initial refresh after 10 seconds
    const initialTimeout = setTimeout(autoRefreshGoogleDocs, 10000)
    
    // Then refresh every 2 minutes
    const interval = setInterval(autoRefreshGoogleDocs, 2 * 60 * 1000)
    
    return () => {
      isActive = false
      clearTimeout(initialTimeout)
      clearInterval(interval)
    }
  }, [user, autoRefreshing])

  // Check if we just completed OAuth and have a pending Google Doc URL
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search)
    if (urlParams.get('google_connected') === 'true') {
      const pendingUrl = localStorage.getItem('pendingGoogleDocUrl')
      if (pendingUrl && user) {
        // Remove from localStorage
        localStorage.removeItem('pendingGoogleDocUrl')
        
        // Set the URL and automatically try to connect
        setDocUrl(pendingUrl)
        setShowConnectDoc(true)
        
        // Automatically try to connect after a short delay
        setTimeout(async () => {
          try {
            const response = await fetch('/api/google/docs/add', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ urlOrFileId: pendingUrl })
            })
            
            if (response.ok) {
              const result = await response.json()
              alert(`Successfully connected Google Doc: ${result.source?.title || 'Document'}`)
              setShowConnectDoc(false)
              setDocUrl('')
              window.location.reload()
            } else if (response.status === 409) {
              // Already connected
              const errorData = await response.json()
              alert(`Google Doc is already connected! You can search for its content now.`)
              setShowConnectDoc(false)
              setDocUrl('')
            } else {
              const errorData = await response.json()
              alert(`Failed to connect Google Doc: ${errorData.details || errorData.error}`)
            }
          } catch (error) {
            console.error('Error auto-connecting Google Doc:', error)
          }
        }, 1000)
      }
    }
  }, [user])

  const handleSearch = async () => {
    if (!query.trim() || !user) return

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: query,
      timestamp: new Date()
    }

    // Add user message to conversation
    const updatedMessages = [...messages, userMessage]
    setMessages(updatedMessages)

    setLoading(true)
    const currentQuery = query
    setQuery('') // Clear input immediately

    try {
      // CRITICAL: Check Google Docs AND Slack for updates BEFORE processing the search query
      console.log('[Search] Checking Google Docs and Slack for updates BEFORE search...')
      
      // Check Google Docs
      try {
        const listResponse = await fetch('/api/google/docs/list')
        if (listResponse.ok) {
          const { googleDocs } = await listResponse.json()
          
          if (googleDocs && googleDocs.length > 0) {
            console.log(`[Search] Checking ${googleDocs.length} Google Doc(s) for updates before search...`)
            
            // Check each Google Doc for updates BEFORE searching
            for (const doc of googleDocs) {
              try {
                const response = await fetch('/api/google/docs/refresh', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ sourceId: doc.id })
                })
                
                if (response.ok) {
                  const result = await response.json()
                  if (result.isModified) {
                    console.log(`[Search] ✓ Updated Google Doc before search: ${doc.title}`)
                  }
                }
              } catch (error) {
                console.error(`[Search] Failed to check doc ${doc.id}:`, error)
              }
            }
          }
        }
      } catch (error) {
        console.error('[Search] Failed to check Google Docs before search:', error)
      }

      // Check Slack channels for new messages
      try {
        const channelsResponse = await fetch('/api/slack/channels')
        if (channelsResponse.ok) {
          const { channels } = await channelsResponse.json()
          
          if (channels && channels.length > 0) {
            console.log(`[Search] Syncing ${channels.length} Slack channel(s) before search...`)
            
            // Sync each channel (this will only fetch new messages since last sync)
            for (const channel of channels) {
              try {
                const syncResponse = await fetch('/api/slack/sync', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ channelId: channel.id })
                })
                
                if (syncResponse.ok) {
                  const result = await syncResponse.json()
                  if (result.messageCount > 0) {
                    console.log(`[Search] ✓ Synced ${result.messageCount} new messages from #${channel.channel_name}`)
                  }
                }
              } catch (error) {
                console.error(`[Search] Failed to sync Slack channel ${channel.id}:`, error)
              }
            }
          }
        }
      } catch (error) {
        console.error('[Search] Failed to check Slack channels before search:', error)
      }

      // Now execute the search with potentially updated Google Doc content
      const res = await fetch(`/api/search/hybrid?q=${encodeURIComponent(currentQuery)}&limit=20`)
      if (!res.ok) throw new Error('Search API failed')
      const data = await res.json()
      const searchResults = (data.results || []) as ResourceWithTags[]
      setResults(searchResults)
      
      // Always generate AI response - either summary of results or general response
      try {
        let aiResponse = ''
        if (searchResults.length > 0) {
          // Generate summary from search results
          const context = searchResults.map(r => {
            let content = `${r.title}: ${r.body || ''}`
            if (r.url) {
              content += `\nURL: ${r.url}`
            }
            if (r.tags && r.tags.length > 0) {
              content += `\nTags: ${r.tags.map(t => t.name).join(', ')}`
            }
            return content
          }).join('\n\n')
          const aiRes = await fetch('/api/ai', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query: currentQuery,
              context,
              type: 'summary'
            })
          })
          if (aiRes.ok) {
            const ai = await aiRes.json()
            aiResponse = ai.response || ''
          }
        } else {
          // Generate general response for queries with no results
          const aiRes = await fetch('/api/ai', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query: currentQuery,
              context: '',
              type: 'general'
            })
          })
          if (aiRes.ok) {
            const ai = await aiRes.json()
            aiResponse = ai.response || ''
          }
        }
        setAiAnswer(aiResponse)

        // Add assistant message to conversation
        const assistantMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: aiResponse,
          results: searchResults,
          timestamp: new Date()
        }

        const finalMessages = [...updatedMessages, assistantMessage]
        setMessages(finalMessages)
        saveConversationHistory(finalMessages)
      } catch {
        setAiAnswer('')
      }
      
      // Log the query
      await logQuery('00000000-0000-0000-0000-000000000000', user.id, currentQuery, searchResults.length)
    } catch (error) {
      console.error('Search error:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
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
      if (res.ok && query.trim()) {
        await handleSearch()
      }
    } catch (err) {
      console.error('Attach upload error:', err)
    } finally {
      setAttaching(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleRefreshGoogleDocs = async () => {
    setRefreshingDocs(true)
    try {
      // Get list of Google Docs
      const listResponse = await fetch('/api/google/docs/list')
      if (!listResponse.ok) {
        throw new Error('Failed to fetch Google Docs list')
      }
      
      const { googleDocs } = await listResponse.json()
      
      if (!googleDocs || googleDocs.length === 0) {
        alert('No Google Docs connected')
        return
      }
      
      // Refresh each Google Doc
      let refreshedCount = 0
      for (const doc of googleDocs) {
        try {
          const refreshResponse = await fetch('/api/google/docs/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sourceId: doc.id })
          })
          
          if (refreshResponse.ok) {
            const result = await refreshResponse.json()
            if (result.isModified) {
              refreshedCount++
            }
          }
        } catch (error) {
          console.error(`Failed to refresh doc ${doc.id}:`, error)
        }
      }
      
      if (refreshedCount > 0) {
        alert(`Refreshed ${refreshedCount} Google Doc${refreshedCount > 1 ? 's' : ''}`)
      } else {
        alert('All Google Docs are up to date')
      }
    } catch (error) {
      console.error('Error refreshing Google Docs:', error)
      alert('Failed to refresh Google Docs')
    } finally {
      setRefreshingDocs(false)
    }
  }

  const handleConnectGoogleDoc = async () => {
    if (!docUrl.trim()) return

    setConnectingDoc(true)
    try {
      // Check if user has Google account connected
      const response = await fetch('/api/google/docs/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          urlOrFileId: docUrl.trim(),
          spaceIds: selectedSpaceIds
        })
      })

      if (response.status === 400) {
        const errorData = await response.json()
        if (errorData.needsOAuth) {
          // Store the Google Docs URL in localStorage before OAuth
          localStorage.setItem('pendingGoogleDocUrl', docUrl.trim())
          
          // User needs to connect Google account first
          const oauthResponse = await fetch('/api/oauth/google/start')
          const { authUrl } = await oauthResponse.json()
          window.location.href = authUrl
          return
        }
      }

      if (response.status === 409) {
        // Already connected
        alert(`Google Doc is already connected! You can search for its content now.`)
        setShowConnectDoc(false)
        setDocUrl('')
        return
      }

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.details || 'Failed to connect Google Doc')
      }

      const result = await response.json()
      console.log('Google Doc connected:', result)
      
      // Close modal and show success
      setShowConnectDoc(false)
      setDocUrl('')
      
      alert(`Successfully connected Google Doc: ${result.source?.title || 'Document'}`)
      
      // Refresh the page to show the new resource
      window.location.reload()
    } catch (error) {
      console.error('Error connecting Google Doc:', error)
      alert(`Failed to connect Google Doc: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setConnectingDoc(false)
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
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-400"></div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <div className="w-full max-w-md p-6">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-[rgba(59,130,246,0.15)] text-blue-400 rounded-xl flex items-center justify-center mx-auto mb-6">
              <div className="text-2xl font-bold">E</div>
            </div>
            <h1 className="text-4xl font-bold text-primary mb-3 tracking-tight">Welcome to Enclave</h1>
            <p className="text-lg text-white/65 leading-relaxed max-w-sm mx-auto mb-8">Your AI-powered knowledge assistant. Please sign in to continue.</p>
            
            {/* Custom Sign In Button */}
            <button 
              onClick={() => window.location.href = '/sign-in'}
              className="w-full bg-gradient-to-r from-blue-600 to-red-600 text-white font-medium py-3 px-6 rounded-xl hover:opacity-90 transition-opacity mb-4"
            >
              Sign In
            </button>
            
            {/* Sign Up Link */}
            <p className="text-sm text-white/50">
              Don't have an account?{' '}
              <button 
                onClick={() => window.location.href = '/sign-up'}
                className="text-blue-400 hover:text-blue-300 underline"
              >
                Sign up
              </button>
            </p>
          </div>
        </div>
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
                onClick={() => setShowGroups(true)}
              >
                <Users className="h-4 w-4 mr-2" />
                Groups
              </Button>
              <Button
                variant="secondary"
                onClick={() => window.location.href = '/resources'}
              >
                <FileText className="h-4 w-4 mr-2" />
                View Resources
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button className="bg-gradient-to-r from-blue-600 to-red-600 hover:from-blue-700 hover:to-red-700 text-white border-0">
                    <Plus className="h-4 w-4 mr-2" />
                    Add
                    <ChevronDown className="h-4 w-4 ml-1" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 bg-[rgba(20,20,24,0.95)] backdrop-blur-xl border-line">
                  <DropdownMenuItem onClick={() => setShowUpload(true)} className="cursor-pointer">
                    <FileText className="h-4 w-4 mr-2" />
                    Add Resource
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setShowConnectDoc(true)} className="cursor-pointer">
                    <Link className="h-4 w-4 mr-2" />
                    Add Live Google Doc
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setShowSlack(true)} className="cursor-pointer">
                    <MessageSquare className="h-4 w-4 mr-2" />
                    Connect Slack
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setShowCalendar(true)} className="cursor-pointer">
                    <Calendar className="h-4 w-4 mr-2" />
                    Connect Google Calendar
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem 
                    onClick={handleRefreshGoogleDocs} 
                    disabled={refreshingDocs}
                    className="cursor-pointer"
                  >
                    {refreshingDocs ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Refreshing...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Refresh All Docs
                      </>
                    )}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
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
        {messages.length > 0 ? (
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-4xl mx-auto px-4 py-8">
              {/* Conversation Messages */}
              <div className="space-y-6">
                {messages.map((message) => (
                  <div key={message.id} className="space-y-4">
                    {/* User Message */}
                    {message.role === 'user' && (
                      <div className="flex justify-end items-start gap-4">
                        <p className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-red-400 font-medium text-lg">
                          {message.content}
                        </p>
                        <div className="w-8 h-8 bg-panel rounded-full flex items-center justify-center flex-shrink-0 text-primary text-sm font-medium">
                          {user?.firstName?.[0]}{user?.lastName?.[0]}
                        </div>
                      </div>
                    )}
                    
                    {/* Assistant Message */}
                    {message.role === 'assistant' && (
                      <div className="flex gap-4">
                        <div className="w-8 h-8 bg-[rgba(59,130,246,0.15)] text-blue-400 rounded-full flex items-center justify-center flex-shrink-0">
                          <Sparkles className="h-4 w-4" />
                        </div>
                        <div className="flex-1 max-w-3xl space-y-4">
                          <p className="text-primary/90 leading-relaxed whitespace-pre-wrap">
                            {message.content}
                          </p>
                      
                      {/* Results for assistant messages */}
                      {message.results && message.results.length > 0 && (
                        <div className="space-y-4">
                          {message.results.map((resource) => (
                  <Card key={resource.id} className="bg-panel border border-line rounded-xl shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
                    <CardContent className="p-6">
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex-1">
                          <div className="flex items-center space-x-2 mb-3">
                            <Badge variant="outline" className="border-blue-500/40 text-blue-400 text-xs bg-transparent">
                              {resource.type}
                            </Badge>
                            {resource.source === 'gdoc' && (
                              <Badge variant="outline" className="border-green-500/40 text-green-400 text-xs bg-green-500/10 flex items-center gap-1">
                                <RefreshCw className="h-3 w-3" />
                                Live Doc
                              </Badge>
                            )}
                            {resource.tags?.slice(0, 2).map((tag) => (
                              <Badge key={tag.id} variant="outline" className="border-blue-500/40 text-primary/80 text-xs bg-transparent">
                                {tag.name}
                              </Badge>
                            ))}
                          </div>
                          <h3 className="text-lg font-semibold text-primary mb-2 tracking-tight">{resource.title}</h3>
                          <p className="text-muted text-sm leading-relaxed">
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
                            className="text-muted hover:text-primary hover:bg-panel-2"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                        )}
                      </div>

                      {/* Event-specific information */}
                      {resource.type === 'event' && resource.event_meta && (
                        <div className="space-y-2 mb-4 p-3 bg-panel-2 rounded-lg border border-line">
                          {resource.event_meta.start_at && (
                            <div className="flex items-center text-sm text-muted">
                              <Calendar className="h-4 w-4 mr-2 text-blue-400" />
                              <span>{formatDate(resource.event_meta.start_at)} at {formatTime(resource.event_meta.start_at)}</span>
                            </div>
                          )}
                          {resource.event_meta.location && (
                            <div className="flex items-center text-sm text-muted">
                              <MapPin className="h-4 w-4 mr-2 text-blue-400" />
                              <span>{resource.event_meta.location}</span>
                            </div>
                          )}
                          {resource.event_meta.cost && (
                            <div className="flex items-center text-sm text-muted">
                              <Clock className="h-4 w-4 mr-2 text-blue-400" />
                              <span>{resource.event_meta.cost}</span>
                            </div>
                          )}
                        </div>
                      )}

                      <div className="text-xs text-subtle flex items-center justify-between">
                        <span>Updated {formatDate(resource.updated_at)}</span>
                        <span>• {resource.source}</span>
                      </div>
                            </CardContent>
                          </Card>
                        ))}
                        </div>
                      )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                <div ref={messagesEndRef} />
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
                  onClick={() => setQuery("What events are coming up?")}
                >
                  What events are coming up?
                </PromptCard>
                <PromptCard
                  icon={<FileText className="w-5 h-5" />}
                  onClick={() => setQuery("Find meeting notes from last week")}
                >
                  Find meeting notes from last week
                </PromptCard>
                <PromptCard
                  icon={<Users className="w-5 h-5" />}
                  onClick={() => setQuery("Show me team documents")}
                >
                  Show me team documents
                </PromptCard>
                <PromptCard
                  icon={<Search className="w-5 h-5" />}
                  onClick={() => setQuery("What's in our knowledge base?")}
                >
                  What's in our knowledge base?
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
                  placeholder="Ask me anything about your documents, events, and resources..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyPress={handleKeyPress}
                  className="flex-1 border-0 bg-transparent text-primary placeholder:text-subtle focus:ring-0 focus:outline-none"
                />
                <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileAttachChange} />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleAttachClick}
                  disabled={attaching}
                >
                  <Paperclip className="h-4 w-4" />
                </Button>
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

      {/* Groups Dialog */}
      <GroupsDialog open={showGroups} onOpenChange={setShowGroups} />

      {/* Slack Dialog */}
      <SlackDialog open={showSlack} onOpenChange={setShowSlack} />

      {/* Calendar Dialog */}
      <CalendarDialog open={showCalendar} onOpenChange={setShowCalendar} />

      {/* Connect Google Doc Modal */}
      {showConnectDoc && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] backdrop-blur-sm">
          <div className="bg-panel border border-line rounded-xl p-6 w-full max-w-md mx-4 shadow-2xl relative z-[10000]">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-primary">Connect Google Doc</h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowConnectDoc(false)}
                className="text-muted hover:text-primary"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-primary mb-2 block">
                  Google Docs URL
                </label>
                <Input
                  type="url"
                  placeholder="https://docs.google.com/document/d/..."
                  value={docUrl}
                  onChange={(e) => setDocUrl(e.target.value)}
                  className="bg-panel border border-line"
                />
                <p className="text-xs text-muted mt-1">
                  Paste the URL of your Google Doc to sync it live
                </p>
              </div>

              <div>
                <label className="text-sm font-medium text-primary mb-2 block">
                  Spaces
                </label>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted">
                      {selectedSpaceIds.length === spaces.length ? 'All spaces selected' : `${selectedSpaceIds.length} of ${spaces.length} spaces selected`}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={selectAllSpaces}
                      className="text-xs px-2 py-1 h-auto"
                    >
                      {selectedSpaceIds.length === spaces.length ? 'Deselect All' : 'Select All'}
                    </Button>
                  </div>
                  
                  <div className="grid grid-cols-1 gap-2 max-h-32 overflow-y-auto">
                    {spaces.map((space) => (
                      <div key={space.id} className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          id={`gdoc-space-${space.id}`}
                          checked={selectedSpaceIds.includes(space.id)}
                          onChange={() => toggleSpace(space.id)}
                          className="rounded border-line bg-panel text-primary focus:ring-primary focus:ring-2"
                        />
                        <label htmlFor={`gdoc-space-${space.id}`} className="text-sm text-primary cursor-pointer flex-1">
                          {space.name}
                        </label>
                      </div>
                    ))}
                  </div>
                  
                  {selectedSpaceIds.length > 0 && (
                    <div className="text-xs text-muted">
                      Selected: {getSelectedSpaceNames()}
                    </div>
                  )}
                </div>
                <p className="text-xs text-muted mt-1">
                  Select which spaces this Google Doc belongs to (default: all spaces)
                </p>
              </div>
              
              <div className="flex items-center space-x-3">
                <Button
                  onClick={handleConnectGoogleDoc}
                  disabled={!docUrl.trim() || connectingDoc}
                  className="bg-gradient-to-r from-blue-600 to-red-600 hover:from-blue-700 hover:to-red-700 text-white border-0 flex-1"
                >
                  {connectingDoc ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Connecting...
                    </>
                  ) : (
                    <>
                      <Link className="h-4 w-4 mr-2" />
                      Connect Doc
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setShowConnectDoc(false)}
                  disabled={connectingDoc}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}