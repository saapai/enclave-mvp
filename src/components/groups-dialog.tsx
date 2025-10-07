'use client'

import { useState, useEffect } from 'react'
import { useUser } from '@clerk/nextjs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Users, Plus, Send, Loader2, X } from 'lucide-react'

interface Space {
  id: string
  name: string
  domain?: string
  created_at: string
}

interface GroupsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function GroupsDialog({ open, onOpenChange }: GroupsDialogProps) {
  const { user } = useUser()
  const [spaces, setSpaces] = useState<Space[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedSpace, setSelectedSpace] = useState<Space | null>(null)
  
  // Create space state
  const [newSpaceName, setNewSpaceName] = useState('')
  const [creatingSpace, setCreatingSpace] = useState(false)
  
  // Members list state
  const [members, setMembers] = useState<any[]>([])
  const [loadingMembers, setLoadingMembers] = useState(false)
  
  // Invite member state
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [inviting, setInviting] = useState(false)

  useEffect(() => {
    if (open && user) {
      fetchSpaces()
    }
  }, [open, user])

  const fetchSpaces = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/spaces')
      if (response.ok) {
        const data = await response.json()
        setSpaces(data.spaces || [])
        
        // Select default space
        const defaultSpace = data.spaces?.find((s: Space) => s.id === '00000000-0000-0000-0000-000000000000')
        if (defaultSpace) {
          setSelectedSpace(defaultSpace)
        }
      }
    } catch (error) {
      console.error('Failed to fetch spaces:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchMembers = async (spaceId: string) => {
    setLoadingMembers(true)
    try {
      const response = await fetch(`/api/spaces/${spaceId}/members`)
      if (response.ok) {
        const data = await response.json()
        setMembers(data.members || [])
      }
    } catch (error) {
      console.error('Failed to fetch members:', error)
      setMembers([])
    } finally {
      setLoadingMembers(false)
    }
  }

  useEffect(() => {
    if (selectedSpace) {
      fetchMembers(selectedSpace.id)
    } else {
      setMembers([])
    }
  }, [selectedSpace])

  const handleCreateSpace = async () => {
    if (!newSpaceName.trim()) {
      alert('Please enter a group name')
      return
    }

    setCreatingSpace(true)
    try {
      const response = await fetch('/api/spaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newSpaceName
        })
      })

      if (response.ok) {
        const data = await response.json()
        setSpaces([data.space, ...spaces])
        setNewSpaceName('')
        alert(`Group "${data.space.name}" created successfully!`)
      } else {
        const error = await response.json()
        alert(`Failed to create group: ${error.error}`)
      }
    } catch (error) {
      console.error('Create space error:', error)
      alert('Failed to create group')
    } finally {
      setCreatingSpace(false)
    }
  }

  const handleInviteMember = async () => {
    if (!inviteEmail.trim()) {
      alert('Please enter an email address')
      return
    }

    if (!selectedSpace) {
      alert('Please select a group first')
      return
    }

    setInviting(true)
    try {
      const response = await fetch(`/api/spaces/${selectedSpace.id}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: inviteEmail,
          name: inviteName
        })
      })

      const data = await response.json()

      if (response.ok) {
        setInviteEmail('')
        setInviteName('')
        alert(data.message || 'Member invited successfully!')
      } else {
        alert(`Failed to invite member: ${data.error}`)
      }
    } catch (error) {
      console.error('Invite member error:', error)
      alert('Failed to invite member')
    } finally {
      setInviting(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] backdrop-blur-sm">
      <div className="bg-panel border border-line rounded-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto shadow-2xl relative z-[10000]">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-line sticky top-0 bg-panel">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-[rgba(59,130,246,0.15)] text-blue-400 rounded-full flex items-center justify-center">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-primary">Groups</h2>
              <p className="text-sm text-muted">Manage your groups and members</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="text-muted hover:text-primary"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="p-6 space-y-6">
          {/* Your Groups */}
          <div>
            <h3 className="text-lg font-semibold text-primary mb-3">Your Groups</h3>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-blue-400" />
              </div>
            ) : spaces.length === 0 ? (
              <Card className="bg-panel-2 border border-line">
                <CardContent className="p-6 text-center">
                  <p className="text-muted">No groups yet. Create one below!</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {spaces.map((space) => (
                  <Card 
                    key={space.id}
                    className={`bg-panel-2 border cursor-pointer transition-colors ${
                      selectedSpace?.id === space.id 
                        ? 'border-blue-500 bg-blue-500/5' 
                        : 'border-line hover:border-line/60'
                    }`}
                    onClick={() => setSelectedSpace(space)}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="font-medium text-primary">{space.name}</h4>
                          {space.domain && (
                            <p className="text-sm text-muted">{space.domain}</p>
                          )}
                        </div>
                        {selectedSpace?.id === space.id && (
                          <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>

          {/* Create Group */}
          <div>
            <h3 className="text-lg font-semibold text-primary mb-3">Create Group</h3>
            <Card className="bg-panel-2 border border-line">
              <CardContent className="p-6 space-y-4">
                <div>
                  <label className="text-sm font-medium text-primary mb-2 block">
                    Group Name *
                  </label>
                  <Input
                    type="text"
                    placeholder="e.g., UCLA SEP"
                    value={newSpaceName}
                    onChange={(e) => setNewSpaceName(e.target.value)}
                    className="bg-panel border border-line"
                  />
                </div>
                <Button
                  onClick={handleCreateSpace}
                  disabled={!newSpaceName.trim() || creatingSpace}
                  className="w-full bg-gradient-to-r from-blue-600 to-red-600 hover:from-blue-700 hover:to-red-700 text-white border-0"
                >
                  {creatingSpace ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <Plus className="h-4 w-4 mr-2" />
                      Create Group
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Group Members */}
          {selectedSpace && (
            <div>
              <h3 className="text-lg font-semibold text-primary mb-3">Group Members</h3>
              <Card className="bg-panel-2 border border-line">
                <CardContent className="p-6">
                  <div className="text-sm text-muted mb-4">
                    <span className="text-primary font-medium">{selectedSpace.name}</span>
                  </div>
                  {loadingMembers ? (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 className="h-5 w-5 animate-spin text-blue-400" />
                    </div>
                  ) : members.length === 0 ? (
                    <p className="text-muted text-sm">No members yet. Invite someone below!</p>
                  ) : (
                    <div className="space-y-2 mb-4">
                      {members.map((member) => (
                        <div key={member.id} className="flex items-center justify-between p-3 bg-panel rounded-lg border border-line">
                          <div>
                            <p className="text-primary font-medium">{member.name || 'Unnamed'}</p>
                            <p className="text-sm text-muted">{member.email}</p>
                          </div>
                          <Badge variant="outline" className="border-blue-500/40 text-blue-400 text-xs bg-transparent">
                            {member.role}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* Invite Member */}
          {selectedSpace && (
            <div>
              <h3 className="text-lg font-semibold text-primary mb-3">Invite Member</h3>
              <Card className="bg-panel-2 border border-line">
                <CardContent className="p-6 space-y-4">
                  <div>
                    <label className="text-sm font-medium text-primary mb-2 block">
                      Email Address *
                    </label>
                    <Input
                      type="email"
                      placeholder="email@domain.com"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      className="bg-panel border border-line"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-primary mb-2 block">
                      Name (Optional)
                    </label>
                    <Input
                      type="text"
                      placeholder="John Doe"
                      value={inviteName}
                      onChange={(e) => setInviteName(e.target.value)}
                      className="bg-panel border border-line"
                    />
                  </div>
                  <Button
                    onClick={handleInviteMember}
                    disabled={!inviteEmail.trim() || inviting}
                    className="w-full bg-gradient-to-r from-blue-600 to-red-600 hover:from-blue-700 hover:to-red-700 text-white border-0"
                  >
                    {inviting ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Sending...
                      </>
                    ) : (
                      <>
                        <Send className="h-4 w-4 mr-2" />
                        Send Invite
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
