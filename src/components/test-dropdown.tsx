"use client"

import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Plus, FileText } from 'lucide-react'

export function TestDropdown() {
  return (
    <div className="p-4 bg-white border rounded">
      <h3>Test Dropdown</h3>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">
            <Plus className="h-4 w-4 mr-2" />
            Test Dropdown
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>
            <FileText className="h-4 w-4 mr-2" />
            Test Item 1
          </DropdownMenuItem>
          <DropdownMenuItem>
            Test Item 2
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
