'use client'

import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Calendar, Loader2, CheckCircle, RefreshCw, Trash2 } from 'lucide-react'

interface CalendarDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface Calendar {
  id: string
  summary: string
  description?: string
  primary?: boolean
  accessRole: string
  backgroundColor?: string
  foregroundColor?: string
}

interface ConnectedCalendar {
  id: string
  calendar_id: string
  calendar_name: string
  calendar_description?: string
  is_primary: boolean
  last_synced: string
}

export function CalendarDialog({ open, onOpenChange }: CalendarDialogProps) {
  const [loading, setLoading] = useState(false)
  const [calendars, setCalendars] = useState<Calendar[]>([])
  const [connectedCalendars, setConnectedCalendars] = useState<ConnectedCalendar[]>([])
  const [syncing, setSyncing] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [needsOAuth, setNeedsOAuth] = useState(false)

  useEffect(() => {
    if (open) {
      loadCalendars()
      loadConnectedCalendars()
    }
  }, [open])

  const loadCalendars = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/google/calendar/list')
      const data = await response.json()

      console.log('Calendar dialog response:', data)

      if (data.needsOAuth || data.needsReauth) {
        setNeedsOAuth(true)
      } else if (data.success) {
        setCalendars(data.calendars || [])
        setNeedsOAuth(false)
        
        if ((data.calendars || []).length === 0) {
          console.warn('No calendars found - user may need to reconnect Google account')
        }
      } else if (data.error) {
        console.error('Calendar list error:', data.error, data.details)
        alert(`Failed to load calendars: ${data.details || data.error}`)
      }
    } catch (error) {
      console.error('Failed to load calendars:', error)
      alert('Failed to connect to calendar service. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const loadConnectedCalendars = async () => {
    try {
      const response = await fetch('/api/google/calendar/sources')
      const data = await response.json()

      if (data.success) {
        setConnectedCalendars(data.calendars || [])
      }
    } catch (error) {
      console.error('Failed to load connected calendars:', error)
    }
  }

  const handleConnectGoogle = async () => {
    try {
      const response = await fetch('/api/oauth/google/start')
      const { authUrl } = await response.json()
      window.location.href = authUrl
    } catch (error) {
      console.error('Failed to start OAuth:', error)
    }
  }

  const handleSyncCalendar = async (calendar: Calendar) => {
    setSyncing(calendar.id)
    try {
      const response = await fetch('/api/google/calendar/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          calendarId: calendar.id,
          calendarName: calendar.summary,
          calendarDescription: calendar.description,
          isPrimary: calendar.primary,
          daysAhead: 90
        })
      })

      const data = await response.json()

      if (data.success) {
        alert(`Successfully synced ${calendar.summary}! Imported ${data.source.eventsCount} events.`)
        loadConnectedCalendars()
      } else if (data.isAlreadyConnected) {
        alert('This calendar is already connected!')
      } else {
        throw new Error(data.error || 'Failed to sync calendar')
      }
    } catch (error) {
      console.error('Failed to sync calendar:', error)
      alert(`Failed to sync calendar: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setSyncing(null)
    }
  }

  const handleRefreshCalendar = async (source: ConnectedCalendar) => {
    setRefreshing(source.id)
    try {
      const response = await fetch('/api/google/calendar/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceId: source.id,
          daysAhead: 90
        })
      })

      const data = await response.json()

      if (data.success) {
        alert(`Successfully refreshed ${source.calendar_name}! Updated ${data.eventsCount} events.`)
        loadConnectedCalendars()
      } else {
        throw new Error(data.error || 'Failed to refresh calendar')
      }
    } catch (error) {
      console.error('Failed to refresh calendar:', error)
      alert(`Failed to refresh calendar: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setRefreshing(null)
    }
  }

  const handleDeleteCalendar = async (source: ConnectedCalendar) => {
    if (!confirm(`Are you sure you want to disconnect ${source.calendar_name}?`)) {
      return
    }

    setDeleting(source.id)
    try {
      const response = await fetch(`/api/google/calendar/sources?sourceId=${source.id}`, {
        method: 'DELETE'
      })

      const data = await response.json()

      if (data.success) {
        alert(`Successfully disconnected ${source.calendar_name}`)
        loadConnectedCalendars()
      } else {
        throw new Error(data.error || 'Failed to delete calendar')
      }
    } catch (error) {
      console.error('Failed to delete calendar:', error)
      alert(`Failed to delete calendar: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setDeleting(null)
    }
  }

  const isCalendarConnected = (calendarId: string) => {
    return connectedCalendars.some(c => c.calendar_id === calendarId)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[rgba(20,20,24,0.98)] backdrop-blur-xl border border-line max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-primary flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Connect Google Calendar
          </DialogTitle>
          <DialogDescription className="text-muted">
            Sync your Google Calendar events to make them searchable in Enclave
          </DialogDescription>
        </DialogHeader>

        {needsOAuth ? (
          <div className="space-y-4 py-6">
                <div className="bg-[rgba(255,255,255,0.08)] p-6 rounded-lg border border-line text-center">
              <Calendar className="h-12 w-12 text-blue-400 mx-auto mb-4" />
              <p className="text-primary mb-2 font-medium">Connect Your Google Account</p>
              <p className="text-muted text-sm mb-4">
                To sync calendars, you need to connect your Google account first.
              </p>
              <Button
                onClick={handleConnectGoogle}
                className="bg-gradient-to-r from-blue-600 to-red-600 hover:from-blue-700 hover:to-red-700 text-white border-0"
              >
                Connect Google Account
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-6 py-4">
            {/* Connected Calendars */}
            {connectedCalendars.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-primary mb-3">Connected Calendars</h3>
                <div className="space-y-2">
                  {connectedCalendars.map(source => (
                    <div
                      key={source.id}
                      className="bg-[rgba(255,255,255,0.1)] p-4 rounded-lg border border-line flex items-center justify-between"
                    >
                      <div className="flex items-center gap-3">
                        <CheckCircle className="h-5 w-5 text-green-400" />
                        <div>
                          <p className="text-primary font-medium">{source.calendar_name}</p>
                          <p className="text-xs text-muted">
                            Last synced: {new Date(source.last_synced).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRefreshCalendar(source)}
                          disabled={refreshing === source.id}
                        >
                          {refreshing === source.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <RefreshCw className="h-4 w-4" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteCalendar(source)}
                          disabled={deleting === source.id}
                          className="text-red-400 hover:text-red-300"
                        >
                          {deleting === source.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Available Calendars */}
            <div>
              <h3 className="text-sm font-semibold text-primary mb-3">Available Calendars</h3>
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
                </div>
              ) : calendars.length === 0 ? (
                <div className="bg-[rgba(255,255,255,0.08)] p-6 rounded-lg border border-line text-center space-y-4">
                  <p className="text-muted">No calendars found</p>
                  <p className="text-sm text-subtle">
                    This might mean you need to reconnect your Google account with Calendar permissions.
                  </p>
                  <Button
                    onClick={handleConnectGoogle}
                    variant="outline"
                    size="sm"
                  >
                    Reconnect Google Account
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  {calendars.map(calendar => {
                    const connected = isCalendarConnected(calendar.id)
                    return (
                  <div
                    key={calendar.id}
                    className="bg-[rgba(255,255,255,0.1)] p-4 rounded-lg border border-line flex items-center justify-between"
                  >
                        <div className="flex items-center gap-3">
                          <div
                            className="w-4 h-4 rounded"
                            style={{ backgroundColor: calendar.backgroundColor || '#3b82f6' }}
                          />
                          <div>
                            <p className="text-primary font-medium flex items-center gap-2">
                              {calendar.summary}
                              {calendar.primary && (
                                <span className="text-xs bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded">
                                  Primary
                                </span>
                              )}
                            </p>
                            {calendar.description && (
                              <p className="text-xs text-muted">{calendar.description}</p>
                            )}
                          </div>
                        </div>
                        <Button
                          variant={connected ? "outline" : "default"}
                          size="sm"
                          onClick={() => handleSyncCalendar(calendar)}
                          disabled={syncing === calendar.id || connected}
                          className={
                            connected
                              ? ''
                              : 'bg-gradient-to-r from-blue-600 to-red-600 hover:from-blue-700 hover:to-red-700 text-white border-0'
                          }
                        >
                          {syncing === calendar.id ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              Syncing...
                            </>
                          ) : connected ? (
                            'Connected'
                          ) : (
                            'Sync Calendar'
                          )}
                        </Button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

