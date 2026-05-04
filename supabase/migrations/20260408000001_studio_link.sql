-- Add optional Mayday Studio user link to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS studio_user_id UUID;

-- Index for fast Studio user lookup
CREATE INDEX IF NOT EXISTS idx_profiles_studio_user_id ON profiles (studio_user_id)
WHERE studio_user_id IS NOT NULL;
