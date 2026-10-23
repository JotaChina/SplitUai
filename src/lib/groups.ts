import type { SupabaseClient } from '@supabase/supabase-js'

export type GroupRecord = {
  id: string
  name: string
  description: string | null
  created_by: string | null
  created_at: string
  archived_at: string | null
}

export type GroupMemberRecord = {
  group_id: string
  user_id: string
  role: 'admin' | 'member'
  joined_at: string
  active: boolean
}

export type GroupProfileRecord = {
  id: string
  display_name: string | null
  username: string | null
}

export type GroupInvitationRecord = {
  id: string
  invited_email: string
  status: 'pending' | 'sent' | 'accepted' | 'revoked' | 'expired'
  created_at: string
  expires_at: string
}

export type MyGroupInvitation = GroupInvitationRecord & { group_id: string; group_name: string }

export type GroupMemberView = GroupMemberRecord & {
  display_name: string | null
  username: string | null
}

export async function listMyGroups(client: SupabaseClient) {
  const { data, error } = await client
    .from('groups')
    .select('id, name, description, created_by, created_at, archived_at')
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

  // The group-creation trigger adds the creator to group_members. A SELECT
  // chained to this INSERT can run its RLS check before that trigger's row is
  // visible to the stable membership helper, so insert first and read after.
  // The database generates id and only grants INSERT on name, description and
  // created_by. Do not compare created_at with the browser clock: clock skew
  // can otherwise hide the successfully inserted row from this follow-up read.
  const { error: insertError } = await client
    .from('groups')
    .insert({
      name,
      description,
      created_by: userId,
    })
  if (insertError) throw insertError

  const query = client
    .from('groups')
    .select('id, name, description, created_by, created_at, archived_at')
    .eq('created_by', userId)
    .eq('name', name)
    .order('created_at', { ascending: false })
    .limit(1)
  const matchingQuery = description === null ? query.is('description', null) : query.eq('description', description)
  const { data, error } = await matchingQuery.maybeSingle()

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
    .select('id, name, description, created_by, created_at, archived_at')
    .single()

  if (error) throw error
  return data as GroupRecord
}

export async function getGroupMembers(client: SupabaseClient, groupId: string) {
  const { data: memberRows, error: memberError } = await client
    .from('group_members')
    .select('group_id, user_id, role, joined_at, active, display_name')
    .eq('group_id', groupId)
    .order('joined_at', { ascending: true })

  if (memberError) throw memberError
  const members = (memberRows ?? []) as (GroupMemberRecord & { display_name: string | null })[]
  if (!members.length) return [] as GroupMemberView[]

  const { data: profileRows, error: profileError } = await client
    .from('profiles')
    .select('id, display_name, username')
    .in('id', members.map((member) => member.user_id))

  if (profileError) throw profileError
  const profiles = new Map(((profileRows ?? []) as GroupProfileRecord[]).map((profile) => [profile.id, profile]))

  return members.map((member) => ({
    ...member,
    display_name: member.display_name ?? profiles.get(member.user_id)?.display_name ?? null,
    username: profiles.get(member.user_id)?.username ?? null,
  }))
}

export async function setMyUsername(client: SupabaseClient, username: string) {
  const { data, error } = await client.rpc('set_my_username', { p_username: username })
  if (error) throw error
  return data as string
}

export async function setGroupArchived(client: SupabaseClient, groupId: string, archived: boolean) {
  const { error } = await client.rpc('set_group_archived', { p_group_id: groupId, p_archived: archived })
  if (error) throw error
}

export async function deleteEmptyGroup(client: SupabaseClient, groupId: string) {
  const { error } = await client.rpc('delete_empty_group', { p_group_id: groupId })
  if (error) throw error
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
  groupId: string,
  email: string,
) {
  const { data, error } = await client.rpc('manage_group_invitation', { p_group_id: groupId, p_email: email, p_action: 'create', p_invitation_id: null })
  if (error) throw error
  const { data: invite, error: readError } = await client.from('group_invitations').select('id, invited_email, status, created_at, expires_at').eq('id', data).single()
  if (readError) throw readError
  return invite as GroupInvitationRecord
}

export async function manageGroupInvitation(client: SupabaseClient, groupId: string, invitationId: string, action: 'resend' | 'cancel') {
  const { error } = await client.rpc('manage_group_invitation', { p_group_id: groupId, p_email: '', p_action: action, p_invitation_id: invitationId })
  if (error) throw error
}

export async function updateGroupMember(client: SupabaseClient, groupId: string, userId: string, role: 'admin' | 'member', displayName: string | null) {
  const { error } = await client.rpc('update_group_member', { p_group_id: groupId, p_user_id: userId, p_role: role, p_display_name: displayName })
  if (error) throw error
}

export async function removeGroupMember(client: SupabaseClient, groupId: string, userId: string) {
  const { error } = await client.rpc('remove_group_member', { p_group_id: groupId, p_user_id: userId })
  if (error) throw error
}

export async function listMyGroupInvitations(client: SupabaseClient) {
  const { data, error } = await client.rpc('list_my_group_invitations')
  if (error) throw error
  return (data ?? []) as MyGroupInvitation[]
}

export async function acceptGroupInvitation(client: SupabaseClient, invitationId: string) {
  const { error } = await client.rpc('accept_group_invitation', { p_invitation_id: invitationId })
  if (error) throw error
}
