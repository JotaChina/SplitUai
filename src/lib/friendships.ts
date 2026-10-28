import type { SupabaseClient } from '@supabase/supabase-js'

export type FriendSearchResult = {
  user_id: string
  username: string
  display_name: string | null
  avatar_url: string | null
  relationship_status: 'pending' | 'accepted' | null
  request_direction: 'incoming' | 'outgoing' | null
}

export type FriendshipView = {
  id: string
  requester_id: string
  addressee_id: string
  status: 'pending' | 'accepted'
  created_at: string
  other_user_id: string
  username: string | null
  display_name: string | null
  avatar_url: string | null
  direction: 'incoming' | 'outgoing'
}

export async function searchFriendByUsername(client: SupabaseClient, username: string) {
  const { data, error } = await client.rpc('search_friend_by_username', { p_username: username })
  if (error) throw error
  return ((data ?? []) as FriendSearchResult[])[0] ?? null
}

export async function listMyFriendships(client: SupabaseClient) {
  const { data, error } = await client.rpc('list_my_friendships')
  if (error) throw error
  return (data ?? []) as FriendshipView[]
}

export async function manageFriendship(client: SupabaseClient, userId: string, action: 'send' | 'accept' | 'decline' | 'cancel' | 'unfriend') {
  const { error } = await client.rpc('manage_friendship', { p_user_id: userId, p_action: action })
  if (error) throw error
}
