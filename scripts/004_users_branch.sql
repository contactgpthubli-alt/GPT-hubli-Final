-- Add branch to users (chosen at student registration)
ALTER TABLE users ADD COLUMN IF NOT EXISTS branch TEXT;
