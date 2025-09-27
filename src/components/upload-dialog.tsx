'use client'

import { useState } from 'react'
import { useUser } from '@clerk/nextjs'
import { X, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'

interface UploadDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function UploadDialog({ open, onOpenChange }: UploadDialogProps) {
  const { user } = useUser()
  const [loading, setLoading] = useState(false)
  
  // Form state
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [url, setUrl] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [newTag, setNewTag] = useState('')

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
      toast.error('Please fill in the title field')
      return
    }

    setLoading(true)
    try {
      // Create the resource
      const { data: resource, error: resourceError } = await supabase
        .from('resource')
        .insert({
          space_id: '00000000-0000-0000-0000-000000000000', // Default space for MVP
          type: 'doc', // Default to document type
          title: title.trim(),
          body: description.trim() || null,
          url: url.trim() || null,
          source: 'upload',
          visibility: 'space',
          created_by: user.id
        } as any) // eslint-disable-line @typescript-eslint/no-explicit-any
        .select()
        .single()

      if (resourceError) {
        throw resourceError
      }

      // Create tags if they don't exist and link them to the resource
      if (tags.length > 0) {
        for (const tagName of tags) {
        // Check if tag exists
        const { data: existingTag } = await supabase
          .from('tag')
          .select('id')
          .eq('space_id', '00000000-0000-0000-0000-000000000000')
          .eq('name', tagName)
          .single()

        let tagId = (existingTag as any)?.id // eslint-disable-line @typescript-eslint/no-explicit-any

          // Create tag if it doesn't exist
          if (!tagId) {
            const { data: newTag, error: tagError } = await supabase
              .from('tag')
              .insert({
                space_id: '00000000-0000-0000-0000-000000000000',
                name: tagName,
                kind: 'topic' // Default kind for user-created tags
              } as any) // eslint-disable-line @typescript-eslint/no-explicit-any
              .select()
              .single()

            if (tagError) {
              console.error('Tag creation error:', tagError)
              continue
            }
            tagId = (newTag as any)?.id // eslint-disable-line @typescript-eslint/no-explicit-any
          }

          // Link tag to resource
          await supabase
            .from('resource_tag')
            .insert({
              resource_id: (resource as any)?.id, // eslint-disable-line @typescript-eslint/no-explicit-any
              tag_id: tagId
            } as any) // eslint-disable-line @typescript-eslint/no-explicit-any
        }
      }

      toast.success('Resource uploaded successfully!')
      
      // Reset form
      setTitle('')
      setDescription('')
      setUrl('')
      setTags([])
      setNewTag('')
      
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
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-surface border-line">
        <DialogHeader>
          <DialogTitle className="text-primary text-xl font-semibold">Upload New Resource</DialogTitle>
          <DialogDescription className="text-muted">
            Add information that members can search for and find instantly.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <div>
            <label className="text-sm font-semibold text-white/70 leading-[1.2] mb-2 block">Title *</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Semi-Formal Bus Schedule"
              className="bg-panel border-line text-[15px] leading-[1.35] placeholder:text-subtle focus:shadow-glow-blue rounded-xl"
            />
            <p className="meta-text mt-1">Give a short title so brothers can find it easily</p>
          </div>

          <div>
            <label className="text-sm font-semibold text-white/70 leading-[1.2] mb-2 block">Description</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what this resource contains..."
              className="bg-panel border-line text-[15px] leading-[1.35] placeholder:text-subtle focus:shadow-glow-blue rounded-xl"
              rows={3}
            />
            <p className="meta-text mt-1">Optional: Add context to help members understand this resource</p>
          </div>

          <div>
            <label className="text-sm font-semibold text-white/70 leading-[1.2] mb-2 block">Link</label>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://..."
              className="bg-panel border-line text-[15px] leading-[1.35] placeholder:text-subtle focus:shadow-glow-blue rounded-xl"
            />
            <p className="meta-text mt-1">Optional: Link to external resources, forms, or documents</p>
          </div>

          <div>
            <label className="text-sm font-semibold text-white/70 leading-[1.2] mb-2 block">Tags</label>
            <div className="space-y-4">
              {/* Selected Tags */}
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {tags.map((tag) => (
                    <Badge 
                      key={tag} 
                      variant="outline" 
                      className="flex items-center gap-1 border border-blue-500/40 text-primary/80 bg-transparent hover:shadow-glow-blue"
                    >
                      {tag}
                      <X
                        className="h-3 w-3 cursor-pointer hover:text-primary"
                        onClick={() => removeTag(tag)}
                      />
                    </Badge>
                  ))}
                </div>
              )}
              
              {/* Add Tag Input */}
              <div className="flex gap-2">
                <Input
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  placeholder="Add a tag..."
                  className="flex-1 bg-panel border-line text-[15px] leading-[1.35] placeholder:text-subtle focus:shadow-glow-blue rounded-xl"
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
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              
              {/* Popular Tags */}
              <div className="space-y-2">
                <p className="meta-text font-medium">Popular tags:</p>
                <div className="flex flex-wrap gap-2">
                  {predefinedTags.slice(0, 8).map((tag) => (
                    <Button
                      key={tag}
                      variant="ghost"
                      size="sm"
                      onClick={() => addTag(tag)}
                      disabled={tags.includes(tag)}
                      className="text-xs px-2 py-1 h-auto disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {tag}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end space-x-3 pt-6 border-t border-line">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={loading || !title.trim()}
          >
            {loading ? 'Uploading...' : 'Upload Resource'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}