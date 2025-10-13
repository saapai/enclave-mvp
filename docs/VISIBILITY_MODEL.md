# Enclave Visibility Model

## Overview

Enclave uses a space-based visibility model where all resources within a space are visible to all members of that space.

## Space Types

### 1. Default Space (Public)
- **Space ID**: `00000000-0000-0000-0000-000000000000`
- **Visibility**: All resources are visible to all users
- **Use Case**: Shared organizational resources, public documents, calendar events

### 2. Personal Spaces (Future)
- **Visibility**: Resources only visible to space members
- **Use Case**: Team-specific or private resources

## Resource Visibility Rules

1. **All resources in the default space are visible to all users**
2. Resources can have a `created_by` field tracking who uploaded them
3. Users can only delete/update resources they created
4. System resources (with `created_by = NULL`) are visible to everyone

## Database Policies (RLS)

### Resource Access
```sql
-- SELECT: All users can view resources in default space
CREATE POLICY "Users can view resources in their spaces" ON resource
  FOR SELECT
  USING (space_id = '00000000-0000-0000-0000-000000000000');

-- INSERT: Users can create resources
CREATE POLICY "Users can create resources" ON resource
  FOR INSERT
  WITH CHECK (created_by::text = auth.uid()::text OR created_by IS NULL);

-- UPDATE: Users can only update their own resources
CREATE POLICY "Users can update their own resources" ON resource
  FOR UPDATE
  USING (created_by IS NULL OR created_by::text = auth.uid()::text);

-- DELETE: Users can only delete their own resources
CREATE POLICY "Users can delete their own resources" ON resource
  FOR DELETE
  USING (created_by IS NULL OR created_by::text = auth.uid()::text);
```

## API-Level Filtering

The API does not apply additional user-based filtering for resources in the default space. All resources are returned as long as they belong to the user's accessible spaces.

## Future Enhancements

- Multi-space support with granular permissions
- Team/group-based resource sharing
- Fine-grained access control (read/write/admin)
- Resource-level privacy settings

