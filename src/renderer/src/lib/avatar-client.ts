import { createAvatarStorage } from './avatar-storage'

export const avatarStorage =
  import.meta.env.VITE_AVATAR_STORAGE_ENABLED === 'true'
    ? createAvatarStorage(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)
    : null
