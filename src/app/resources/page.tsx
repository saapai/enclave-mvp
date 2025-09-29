'use client'

import { useState, useEffect } from 'react'
import { useUser } from '@clerk/nextjs'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { 
  Trash2, 
  ExternalLink, 
  Calendar, 
  MapPin, 
  Clock, 
  FileText,
  ArrowLeft,
  Eye
} from 'lucide-react'
import Link from 'next/link'

interface ResourceWithTags {
  id: string
  title: string
  body?: string
  type: string
  url?: string
  updated_at: string
  source: string
  tags: Array<{ id: string; name: string }>
  event_meta?: {
    start_at?: string
    location?: string
    cost?: string
  }
}

export default function ResourcesPage() {
  const { user, isLoaded } = useUser()
  const [resources, setResources] = useState<ResourceWithTags[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedResource, setSelectedResource] = useState<ResourceWithTags | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  useEffect(() => {
    if (isLoaded && user) {
      fetchResources()
    }
  }, [isLoaded, user])

  const fetchResources = async () => {
    try {
      const response = await fetch('/api/resources')
      if (response.ok) {
        const data = await response.json()
        setResources(data.resources || [])
      }
    } catch (error) {
      console.error('Failed to fetch resources:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (resourceId: string) => {
    if (!confirm('Are you sure you want to delete this resource?')) return
    
    setDeleting(resourceId)
    try {
      const response = await fetch(`/api/resources/${resourceId}`, {
        method: 'DELETE'
      })
      
      if (response.ok) {
        setResources(resources.filter(r => r.id !== resourceId))
        if (selectedResource?.id === resourceId) {
          setSelectedResource(null)
        }
      } else {
        alert('Failed to delete resource')
      }
    } catch (error) {
      console.error('Delete error:', error)
      alert('Failed to delete resource')
    } finally {
      setDeleting(null)
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
        <div className="text-center">
          <h1 className="text-2xl font-bold text-primary mb-4">Please sign in</h1>
          <Link href="/sign-in">
            <Button>Sign In</Button>
          </Link>
        </div>
      </div>
    )
  }

  if (selectedResource) {
    return (
      <div className="min-h-screen bg-surface">
        <div className="max-w-4xl mx-auto px-4 py-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center space-x-4">
              <Button
                variant="ghost"
                onClick={() => setSelectedResource(null)}
                className="text-muted hover:text-primary"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Resources
              </Button>
            </div>
            <div className="flex items-center space-x-2">
              <Button
                variant="outline"
                onClick={() => handleDelete(selectedResource.id)}
                disabled={deleting === selectedResource.id}
                className="text-red-400 border-red-400 hover:bg-red-400/10"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                {deleting === selectedResource.id ? 'Deleting...' : 'Delete'}
              </Button>
            </div>
          </div>

          {/* Resource Details */}
          <Card className="bg-panel border border-line rounded-xl">
            <CardContent className="p-8">
              <div className="mb-6">
                <div className="flex items-center space-x-2 mb-3">
                  <Badge variant="outline" className="border-blue-500/40 text-blue-400 text-xs bg-transparent">
                    {selectedResource.type}
                  </Badge>
                  {selectedResource.tags?.map((tag) => (
                    <Badge key={tag.id} variant="outline" className="border-blue-500/40 text-primary/80 text-xs bg-transparent">
                      {tag.name}
                    </Badge>
                  ))}
                </div>
                <h1 className="text-3xl font-bold text-primary mb-4">{selectedResource.title}</h1>
                {selectedResource.url && (
                  <div className="mb-4">
                    <a
                      href={selectedResource.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center text-blue-400 hover:text-blue-300"
                    >
                      <ExternalLink className="h-4 w-4 mr-2" />
                      {selectedResource.url}
                    </a>
                  </div>
                )}
              </div>

              {/* Event-specific information */}
              {selectedResource.type === 'event' && selectedResource.event_meta && (
                <div className="mb-6 p-4 bg-panel-2 rounded-lg border border-line">
                  <h3 className="text-lg font-semibold text-primary mb-3">Event Details</h3>
                  <div className="space-y-2">
                    {selectedResource.event_meta.start_at && (
                      <div className="flex items-center text-sm text-muted">
                        <Calendar className="h-4 w-4 mr-2 text-blue-400" />
                        <span>{formatDate(selectedResource.event_meta.start_at)} at {formatTime(selectedResource.event_meta.start_at)}</span>
                      </div>
                    )}
                    {selectedResource.event_meta.location && (
                      <div className="flex items-center text-sm text-muted">
                        <MapPin className="h-4 w-4 mr-2 text-blue-400" />
                        <span>{selectedResource.event_meta.location}</span>
                      </div>
                    )}
                    {selectedResource.event_meta.cost && (
                      <div className="flex items-center text-sm text-muted">
                        <Clock className="h-4 w-4 mr-2 text-blue-400" />
                        <span>{selectedResource.event_meta.cost}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Content */}
              {selectedResource.body && (
                <div className="mb-6">
                  <h3 className="text-lg font-semibold text-primary mb-3">Content</h3>
                  <div className="prose prose-invert max-w-none">
                    <p className="text-muted leading-relaxed whitespace-pre-wrap">{selectedResource.body}</p>
                  </div>
                </div>
              )}

              {/* Metadata */}
              <div className="pt-6 border-t border-line">
                <div className="flex items-center justify-between text-sm text-subtle">
                  <span>Updated {formatDate(selectedResource.updated_at)}</span>
                  <span>• {selectedResource.source}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-surface">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-primary mb-2">Resources</h1>
            <p className="text-muted">Manage your chapter's resources and information</p>
          </div>
          <Link href="/">
            <Button variant="outline">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Search
            </Button>
          </Link>
        </div>

        {/* Resources List */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400"></div>
          </div>
        ) : resources.length === 0 ? (
          <Card className="bg-panel border border-line rounded-xl">
            <CardContent className="p-12 text-center">
              <FileText className="h-16 w-16 text-muted mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-primary mb-2">No resources yet</h3>
              <p className="text-muted mb-6">Start by adding your first resource to get started.</p>
              <Link href="/">
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Resource
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {resources.map((resource) => (
              <Card key={resource.id} className="bg-panel border border-line rounded-xl hover:bg-panel-2 transition-colors">
                <CardContent className="p-6">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center space-x-2 mb-3">
                        <Badge variant="outline" className="border-blue-500/40 text-blue-400 text-xs bg-transparent">
                          {resource.type}
                        </Badge>
                        {resource.tags?.slice(0, 3).map((tag) => (
                          <Badge key={tag.id} variant="outline" className="border-blue-500/40 text-primary/80 text-xs bg-transparent">
                            {tag.name}
                          </Badge>
                        ))}
                        {resource.tags && resource.tags.length > 3 && (
                          <Badge variant="outline" className="border-blue-500/40 text-primary/80 text-xs bg-transparent">
                            +{resource.tags.length - 3} more
                          </Badge>
                        )}
                      </div>
                      <h3 className="text-lg font-semibold text-primary mb-2">{resource.title}</h3>
                      <p className="text-muted text-sm leading-relaxed mb-4">
                        {resource.body && resource.body.length > 200
                          ? `${resource.body.substring(0, 200)}...`
                          : resource.body}
                      </p>
                      <div className="flex items-center justify-between">
                        <div className="text-xs text-subtle">
                          Updated {formatDate(resource.updated_at)} • {resource.source}
                        </div>
                        <div className="flex items-center space-x-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSelectedResource(resource)}
                            className="text-muted hover:text-primary"
                          >
                            <Eye className="h-4 w-4 mr-1" />
                            View
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDelete(resource.id)}
                            disabled={deleting === resource.id}
                            className="text-red-400 hover:text-red-300 hover:bg-red-400/10"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

