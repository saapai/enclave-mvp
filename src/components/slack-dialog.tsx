'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Loader2, MessageSquare, Hash, Lock, RefreshCw, Check, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'

interface SlackAccount {
  id: string
  teamName: string
  teamId: string
}

interface SlackChannel {
  id: string
  slack_channel_id: string
  channel_name: string
  channel_type: string
  is_archived: boolean
  is_member: boolean
  last_indexed_at?: string
  message_count: number
  auto_sync: boolean
}

interface SlackDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SlackDialog({ open, onOpenChange }: SlackDialogProps) {
  const [loading, setLoading] = useState(false)
  const [slackAccount, setSlackAccount] = useState<SlackAccount | null>(null)
  const [channels, setChannels] = useState<SlackChannel[]>([])
  const [syncing, setSyncing] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (open) {
      fetchSlackData()
    }
  }, [open])

  const fetchSlackData = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/slack/channels')
      if (response.ok) {
        const data = await response.json()
        setSlackAccount(data.slackAccount)
        setChannels(data.channels)
      } else if (response.status === 404) {
        // Slack not connected
        setSlackAccount(null)
        setChannels([])
      }
    } catch (error) {
      console.error('Failed to fetch Slack data:', error)
      toast.error('Failed to load Slack data')
    } finally {
      setLoading(false)
    }
  }

  const handleConnectSlack = () => {
    window.location.href = '/api/oauth/slack/start'
  }

  const handleSyncChannel = async (channelId: string, channelName: string) => {
    setSyncing({ ...syncing, [channelId]: true })
    try {
      const response = await fetch('/api/slack/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId })
      })

      if (response.ok) {
        const data = await response.json()
        toast.success(`Synced ${data.messageCount} messages from #${channelName}`)
        await fetchSlackData() // Refresh channel list
      } else {
        toast.error(`Failed to sync #${channelName}`)
      }
    } catch (error) {
      console.error('Sync error:', error)
      toast.error(`Failed to sync #${channelName}`)
    } finally {
      setSyncing({ ...syncing, [channelId]: false })
    }
  }

  const getChannelIcon = (channelType: string) => {
    if (channelType === 'private_channel') {
      return <Lock className="h-4 w-4" />
    }
    return <Hash className="h-4 w-4" />
  }

  const formatLastIndexed = (date?: string) => {
    if (!date) return 'Never'
    const d = new Date(date)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)

    if (minutes < 1) return 'Just now'
    if (minutes < 60) return `${minutes}m ago`
    if (hours < 24) return `${hours}h ago`
    return `${days}d ago`
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-primary" />
            Slack Integration
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted" />
            </div>
          ) : !slackAccount ? (
            <div className="text-center py-8 space-y-4">
              <MessageSquare className="h-16 w-16 mx-auto text-muted" />
              <div>
                <h3 className="text-lg font-semibold text-primary mb-2">
                  Connect Your Slack Workspace
                </h3>
                <p className="text-sm text-muted mb-4">
                  Import messages from your Slack channels to search and query them in Enclave
                </p>
              </div>
              <Button
                onClick={handleConnectSlack}
                className="bg-gradient-to-r from-blue-600 to-red-600 hover:from-blue-700 hover:to-red-700"
              >
                <MessageSquare className="h-4 w-4 mr-2" />
                Connect Slack
              </Button>
              <div className="text-xs text-muted mt-4 space-y-1">
                <p>✓ Thread-aware message indexing</p>
                <p>✓ Channel context preservation</p>
                <p>✓ Semantic search across all messages</p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Workspace Info */}
              <div className="bg-panel border border-line rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-primary">
                      {slackAccount.teamName}
                    </h3>
                    <p className="text-sm text-muted">
                      {channels.length} channels connected
                    </p>
                  </div>
                  <Badge variant="outline" className="border-green-500/40 text-green-400 bg-green-500/10">
                    <Check className="h-3 w-3 mr-1" />
                    Connected
                  </Badge>
                </div>
              </div>

              {/* Channels List */}
              <div>
                <h4 className="text-sm font-semibold text-primary mb-3">
                  Channels ({channels.filter(c => !c.is_archived).length})
                </h4>
                <div className="space-y-2">
                  {channels.length === 0 ? (
                    <div className="text-center py-4 text-muted">
                      <AlertCircle className="h-8 w-8 mx-auto mb-2" />
                      <p className="text-sm">No channels found</p>
                    </div>
                  ) : (
                    channels
                      .filter(channel => !channel.is_archived)
                      .map((channel) => (
                        <div
                          key={channel.id}
                          className="bg-panel border border-line rounded-lg p-3 flex items-center justify-between"
                        >
                          <div className="flex items-center gap-3 flex-1">
                            <div className="text-muted">
                              {getChannelIcon(channel.channel_type)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-primary">
                                  {channel.channel_name}
                                </span>
                                {channel.channel_type === 'private_channel' && (
                                  <Badge variant="outline" className="text-xs border-yellow-500/40 text-yellow-400">
                                    Private
                                  </Badge>
                                )}
                              </div>
                              <div className="flex items-center gap-3 text-xs text-muted mt-1">
                                <span>{channel.message_count} messages</span>
                                <span>•</span>
                                <span>
                                  Last synced: {formatLastIndexed(channel.last_indexed_at)}
                                </span>
                              </div>
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleSyncChannel(channel.id, channel.channel_name)}
                            disabled={syncing[channel.id]}
                          >
                            {syncing[channel.id] ? (
                              <>
                                <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                                Syncing...
                              </>
                            ) : (
                              <>
                                <RefreshCw className="h-3 w-3 mr-2" />
                                Sync
                              </>
                            )}
                          </Button>
                        </div>
                      ))
                  )}
                </div>
              </div>

              {/* Archived Channels */}
              {channels.filter(c => c.is_archived).length > 0 && (
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted hover:text-primary">
                    Show archived channels ({channels.filter(c => c.is_archived).length})
                  </summary>
                  <div className="space-y-2 mt-2">
                    {channels
                      .filter(channel => channel.is_archived)
                      .map((channel) => (
                        <div
                          key={channel.id}
                          className="bg-panel border border-line rounded-lg p-3 opacity-50"
                        >
                          <div className="flex items-center gap-3">
                            <div className="text-muted">
                              {getChannelIcon(channel.channel_type)}
                            </div>
                            <div className="flex-1">
                              <span className="font-medium text-primary">
                                {channel.channel_name}
                              </span>
                              <Badge variant="outline" className="ml-2 text-xs">
                                Archived
                              </Badge>
                            </div>
                          </div>
                        </div>
                      ))}
                  </div>
                </details>
              )}

              {/* Info Box */}
              <div className="bg-blue-500/10 border border-blue-500/40 rounded-lg p-3 text-sm">
                <p className="text-blue-400 font-medium mb-1">💡 Tip</p>
                <p className="text-muted">
                  Sync channels to make their messages searchable in Enclave. 
                  Messages are indexed with thread context and channel awareness for better search results.
                </p>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

