'use client'

import { useState, useRef, useEffect } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ExternalLink, Calendar, MapPin, Clock } from 'lucide-react'

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

interface LazyResourceCardProps {
  resource: ResourceWithTags
  onView?: (resource: ResourceWithTags) => void
  onDelete?: (resourceId: string) => void
  deleting?: string | null
}

export function LazyResourceCard({ resource, onView, onDelete, deleting }: LazyResourceCardProps) {
  const [isVisible, setIsVisible] = useState(false)
  const [hasLoaded, setHasLoaded] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !hasLoaded) {
          setIsVisible(true)
          setHasLoaded(true)
          observer.disconnect()
        }
      },
      { threshold: 0.1 }
    )

    if (cardRef.current) {
      observer.observe(cardRef.current)
    }

    return () => observer.disconnect()
  }, [hasLoaded])

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

  return (
    <div ref={cardRef} className="min-h-[200px]">
      {isVisible ? (
        <Card className="bg-panel border border-line rounded-xl hover:bg-panel-2 transition-colors">
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
                    {onView && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onView(resource)}
                        className="text-muted hover:text-primary"
                      >
                        View
                      </Button>
                    )}
                    {onDelete && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onDelete(resource.id)}
                        disabled={deleting === resource.id}
                        className="text-red-400 hover:text-red-300 hover:bg-red-400/10"
                      >
                        Delete
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="bg-panel border border-line rounded-xl p-6 animate-pulse">
          <div className="space-y-3">
            <div className="flex space-x-2">
              <div className="h-5 w-16 bg-gray-700 rounded"></div>
              <div className="h-5 w-12 bg-gray-700 rounded"></div>
            </div>
            <div className="h-6 w-3/4 bg-gray-700 rounded"></div>
            <div className="space-y-2">
              <div className="h-4 w-full bg-gray-700 rounded"></div>
              <div className="h-4 w-2/3 bg-gray-700 rounded"></div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}






