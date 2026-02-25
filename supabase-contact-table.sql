-- Run this in Supabase Dashboard → SQL Editor to create the table for the support page contact form.
-- Submissions from the contact form on /support can be stored here.

CREATE TABLE IF NOT EXISTS public.contact_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    category VARCHAR(100),
    message TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Allow anonymous inserts from the website (support form).
ALTER TABLE public.contact_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow anonymous insert" ON public.contact_submissions;
CREATE POLICY "Allow anonymous insert"
    ON public.contact_submissions
    FOR INSERT
    TO anon
    WITH CHECK (true);

-- Optional: restrict read to authenticated users or service role only.
-- CREATE POLICY "No public read" ON public.contact_submissions FOR SELECT USING (false);
