'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useSpace } from './space-context'
import { toast } from 'sonner'

type SpaceItem = { id: string; name: string; role: string }

export function GroupsPanel() {
  const { currentSpaceId, currentSpaceName, setSpace } = useSpace()
  const [spaces, setSpaces] = useState<SpaceItem[]>([])
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')

  const loadSpaces = async () => {
    try {
      const res = await fetch('/api/spaces')
      if (!res.ok) throw new Error('Failed to load spaces')
      const data = await res.json()
      setSpaces(data.spaces || [])
    } catch (e) {
      toast.error('Failed to load groups')
    }
  }

  useEffect(() => {
    loadSpaces()
  }, [])

  const createSpace = async () => {
    if (!newName.trim()) return
    setCreating(true)
    try {
      const res = await fetch('/api/spaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() })
      })
      if (!res.ok) throw new Error('Failed to create group')
      setNewName('')
      await loadSpaces()
      toast.success('Group created')
    } catch (e) {
      toast.error('Could not create group')
    } finally {
      setCreating(false)
    }
  }

  const invite = async (spaceId: string) => {
    if (!inviteEmail.trim()) return
    try {
      const res = await fetch('/api/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spaceId, email: inviteEmail.trim().toLowerCase() })
      })
      if (!res.ok) throw new Error('Invite failed')
      setInviteEmail('')
      toast.success('Invitation added')
    } catch (e) {
      toast.error('Could not invite user')
    }
  }

  return (
    <div className="space-y-4">
      <Card className="bg-panel border border-line rounded-xl">
        <CardHeader>
          <CardTitle className="text-primary text-base">Your Groups</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {spaces.map((s) => (
            <div key={s.id} className="flex items-center justify-between">
              <div className="text-sm text-primary">{s.name} <span className="text-subtle">({s.role})</span></div>
              <div className="flex items-center gap-2">
                <Button variant="secondary" onClick={() => setSpace(s.id, s.name)}>Open</Button>
              </div>
            </div>
          ))}
          {spaces.length === 0 && (
            <div className="text-subtle text-sm">No groups yet.</div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-panel border border-line rounded-xl">
        <CardHeader>
          <CardTitle className="text-primary text-base">Create Group</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Group name" />
          <Button onClick={createSpace} disabled={creating || !newName.trim()}>Create</Button>
        </CardContent>
      </Card>

      <Card className="bg-panel border border-line rounded-xl">
        <CardHeader>
          <CardTitle className="text-primary text-base">Invite Member</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="text-xs text-subtle">Current: {currentSpaceName}</div>
          <div className="flex gap-2">
            <Input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="email@domain.com" />
            <Button onClick={() => invite(currentSpaceId)} disabled={!inviteEmail.trim()}>Invite</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}


