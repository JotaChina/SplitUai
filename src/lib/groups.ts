import type { SupabaseClient } from '@supabase/supabase-js'

export type GroupRecord = {
  id: string
  name: string
  description: string | null
  created_by: string | null
  created_at: string
}

export type GroupMemberRecord = {
  group_id: string
  user_id: string
  role: 'admin' | 'member'
  joined_at: string
}

export type GroupProfileRecord = {
  id: string
  display_name: string | null
}

export type GroupInvitationRecord = {
  id: string
  invited_email: string
  status: 'pending' | 'sent' | 'revoked' | 'expired'
  created_at: string
  expires_at: string
}

export type GroupMemberView = GroupMemberRecord & {
  display_name: string | null
}

export async function listMyGroups(client: SupabaseClient) {
  const { data, error } = await client
    .from('groups')
    .select('id, name, description, created_by, created_at')
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as GroupRecord[]
}

export async function createGroup(
  client: SupabaseClient,
  userId: string,
  values: { name: string; description: string },
) {
  const name = values.name.trim()
  const description = values.description.trim() || null
  const createdAfter = new Date().toISOString()

  // The group-creation trigger adds the creator to group_members. A SELECT
  // chained to this INSERT can run its RLS check before that trigger's row is
  // visible to the stable membership helper, so insert first and read after.
  const { error: insertError } = await client
    .from('groups')
    .insert({
      name,
      description,
      created_by: userId,
    })
  if (insertError) throw insertError

  let query = client
    .from('groups')
    .select('id, name, description, created_by, created_at')
    .eq('created_by', userId)
    .eq('name', name)
    .gte('created_at', createdAfter)
    .order('created_at', { ascending: false })
    .limit(1)
  query = description === null ? query.is('description', null) : query.eq('description', description)
  const { data, error } = await query.maybeSingle()

  if (error) throw error
  if (!data) throw new Error('O grupo foi criado, mas não foi possível carregá-lo.')
  return data as GroupRecord
}

export async function updateGroup(
  client: SupabaseClient,
  groupId: string,
  values: { name: string; description: string },
) {
  const { data, error } = await client
    .from('groups')
    .update({ name: values.name.trim(), description: values.description.trim() || null })
    .eq('id', groupId)
    .select('id, name, description, created_by, created_at')
    .single()

  if (error) throw error
  return data as GroupRecord
}

export async function getGroupMembers(client: SupabaseClient, groupId: string) {
  const { data: memberRows, error: memberError } = await client
    .from('group_members')
    .select('group_id, user_id, role, joined_at')
    .eq('group_id', groupId)
    .order('joined_at', { ascending: true })

  if (memberError) throw memberError
  const members = (memberRows ?? []) as GroupMemberRecord[]
  if (!members.length) return [] as GroupMemberView[]

  const { data: profileRows, error: profileError } = await client
    .from('profiles')
    .select('id, display_name')
    .in('id', members.map((member) => member.user_id))

  if (profileError) throw profileError
  const profiles = new Map(((profileRows ?? []) as GroupProfileRecord[]).map((profile) => [profile.id, profile]))

  return members.map((member) => ({
    ...member,
    display_name: profiles.get(member.user_id)?.display_name ?? null,
  }))
}

export async function listGroupInvitations(client: SupabaseClient, groupId: string) {
  const { data, error } = await client
    .from('group_invitations')
    .select('id, invited_email, status, created_at, expires_at')
    .eq('group_id', groupId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as GroupInvitationRecord[]
}

export async function createGroupInvitation(
  client: SupabaseClient,
  userId: string,
  groupId: string,
  email: string,
) {
  const normalizedEmail = email.trim().toLowerCase()
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await client
    .from('group_invitations')
    .insert({
      group_id: groupId,
      invited_email: normalizedEmail,
      invited_by: userId,
      status: 'pending',
      expires_at: expiresAt,
    })
    .select('id, invited_email, status, created_at, expires_at')
    .single()

  if (error) throw error
  return data as GroupInvitationRecord
}
