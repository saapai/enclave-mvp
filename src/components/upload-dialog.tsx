'use client'

import { useState } from 'react'
import { useUser } from '@clerk/nextjs'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'

interface UploadDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function UploadDialog({ open, onOpenChange }: UploadDialogProps) {
  const { user } = useUser()
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('basic')
  
  // Basic form state
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [type, setType] = useState<'event' | 'doc' | 'form' | 'link' | 'faq'>('doc')
  const [url, setUrl] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [newTag, setNewTag] = useState('')
  const [file, setFile] = useState<File | null>(null)
  
  // Event-specific state
  const [startAt, setStartAt] = useState('')
  const [endAt, setEndAt] = useState('')
  const [location, setLocation] = useState('')
  const [rsvpLink, setRsvpLink] = useState('')
  const [cost, setCost] = useState('')
  const [dressCode, setDressCode] = useState('')

  const predefinedTags = [
    'rush', 'philanthropy', 'social', 'academics', 'athletics', 'housing', 'alumni', 'risk', 'finance', 'tech',
    'date', 'time', 'location', 'cost', 'ride', 'attire', 'rsvp',
    'pledges', 'actives', 'officers',
    'bylaws', 'handbook', 'forms', 'waivers'
  ]

  const addTag = (tag: string) => {
    if (tag && !tags.includes(tag)) {
      setTags([...tags, tag])
    }
  }

  const removeTag = (tagToRemove: string) => {
    setTags(tags.filter(tag => tag !== tagToRemove))
  }

  const handleSubmit = async () => {
    if (!user || !title.trim()) {
      toast.error('Please fill in all required fields')
      return
    }

    setLoading(true)
    try {
      // If a file is provided, send multipart form data to the upload API which handles
      // storage upload, text extraction, tag linking, and optional event_meta.
      if (file) {
        const form = new FormData()
        form.append('file', file)
        form.append('title', title)
        form.append('description', description)
        form.append('type', type)
        form.append('url', url)
        form.append('tags', JSON.stringify(tags))
        form.append('startAt', startAt)
        form.append('endAt', endAt)
        form.append('location', location)
        form.append('rsvpLink', rsvpLink)
        form.append('cost', cost)
        form.append('dressCode', dressCode)

        const res = await fetch('/api/upload', {
          method: 'POST',
          body: form
        })
        if (!res.ok) {
          throw new Error('Upload failed')
        }
      } else {
        // Fallback to existing direct DB insert flow when no file selected
        const { data: resource, error: resourceError } = await supabase
          .from('resource')
          .insert({
            space_id: '00000000-0000-0000-0000-000000000000',
            type,
            title: title.trim(),
            body: description.trim() || null,
            url: url.trim() || null,
            source: 'upload',
            visibility: 'space',
            created_by: user.id
          } as any)
          .select()
          .single()

        if (resourceError) {
          throw resourceError
        }

        if (tags.length > 0) {
          for (const tagName of tags) {
            const { data: existingTag } = await supabase
              .from('tag')
              .select('id')
              .eq('space_id', '00000000-0000-0000-000000000000')
              .eq('name', tagName)
              .single()

            let tagId = (existingTag as any)?.id
            if (!tagId) {
              const { data: newTag, error: tagError } = await supabase
                .from('tag')
                .insert({
                  space_id: '00000000-0000-0000-0000-000000000000',
                  name: tagName,
                  kind: 'topic'
                } as any)
                .select()
                .single()
              if (tagError) {
                console.error('Tag creation error:', tagError)
                continue
              }
              tagId = (newTag as any)?.id
            }

            await supabase
              .from('resource_tag')
              .insert({
                resource_id: (resource as any)?.id,
                tag_id: tagId
              } as any)
          }
        }

        if (type === 'event' && (startAt || endAt || location || rsvpLink || cost || dressCode)) {
          await supabase
            .from('event_meta')
            .insert({
              resource_id: (resource as any)?.id,
              start_at: startAt || null,
              end_at: endAt || null,
              location: location || null,
              rsvp_link: rsvpLink || null,
              cost: cost || null,
              dress_code: dressCode || null
            } as any)
        }
      }

      toast.success('Resource uploaded successfully!')
      
      // Reset form
      setTitle('')
      setDescription('')
      setType('doc')
      setUrl('')
      setTags([])
      setFile(null)
      setNewTag('')
      setStartAt('')
      setEndAt('')
      setLocation('')
      setRsvpLink('')
      setCost('')
      setDressCode('')
      setActiveTab('basic')
      
      onOpenChange(false)
    } catch (error) {
      console.error('Upload error:', error)
      toast.error('Failed to upload resource. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Upload New Resource</DialogTitle>
          <DialogDescription>
            Add information that members can search for and find instantly.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="basic">Basic Info</TabsTrigger>
            <TabsTrigger value="event" disabled={type !== 'event'}>Event Details</TabsTrigger>
          </TabsList>

          <TabsContent value="basic" className="space-y-4">
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">Title *</label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Semi-Formal Bus Schedule"
                  className="mt-1"
                />
              </div>

              <div>
                <label className="text-sm font-medium">Type *</label>
                <Select value={type} onValueChange={(value: 'event' | 'doc' | 'form' | 'link' | 'faq') => setType(value)}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="event">Event</SelectItem>
                    <SelectItem value="doc">Document</SelectItem>
                    <SelectItem value="form">Form</SelectItem>
                    <SelectItem value="link">Link</SelectItem>
                    <SelectItem value="faq">FAQ</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm font-medium">Description</label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe what this resource contains..."
                  className="mt-1"
                  rows={3}
                />
              </div>

              <div>
                <label className="text-sm font-medium">URL (optional)</label>
                <Input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://..."
                  className="mt-1"
                />
              </div>

              <div>
                <label className="text-sm font-medium">File (optional)</label>
                <Input
                  type="file"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  className="mt-1"
                />
                <div className="text-xs text-gray-500 mt-1">
                  We support text extraction for PDF, DOCX, HTML, CSV, JSON, TXT. Other files are stored and linked.
                </div>
              </div>

              <div>
                <label className="text-sm font-medium">Tags</label>
                <div className="mt-1 space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {tags.map((tag) => (
                      <Badge key={tag} variant="secondary" className="flex items-center gap-1">
                        {tag}
                        <X
                          className="h-3 w-3 cursor-pointer"
                          onClick={() => removeTag(tag)}
                        />
                      </Badge>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      value={newTag}
                      onChange={(e) => setNewTag(e.target.value)}
                      placeholder="Add a tag..."
                      className="flex-1"
                      onKeyPress={(e) => {
                        if (e.key === 'Enter') {
                          addTag(newTag.trim())
                          setNewTag('')
                        }
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        addTag(newTag.trim())
                        setNewTag('')
                      }}
                    >
                      Add
                    </Button>
                  </div>
                  <div className="text-xs text-gray-500">
                    Popular tags: {predefinedTags.slice(0, 8).join(', ')}
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="event" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Event Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium">Start Date & Time</label>
                    <Input
                      type="datetime-local"
                      value={startAt}
                      onChange={(e) => setStartAt(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">End Date & Time</label>
                    <Input
                      type="datetime-local"
                      value={endAt}
                      onChange={(e) => setEndAt(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium">Location</label>
                  <Input
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="e.g., Student Union Ballroom"
                    className="mt-1"
                  />
                </div>

                <div>
                  <label className="text-sm font-medium">RSVP Link</label>
                  <Input
                    value={rsvpLink}
                    onChange={(e) => setRsvpLink(e.target.value)}
                    placeholder="https://..."
                    className="mt-1"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium">Cost</label>
                    <Input
                      value={cost}
                      onChange={(e) => setCost(e.target.value)}
                      placeholder="e.g., $25 per person"
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Dress Code</label>
                    <Input
                      value={dressCode}
                      onChange={(e) => setDressCode(e.target.value)}
                      placeholder="e.g., Semi-formal"
                      className="mt-1"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <div className="flex justify-end space-x-2 pt-4">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={loading || !title.trim()}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {loading ? 'Uploading...' : 'Upload Resource'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
