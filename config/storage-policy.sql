-- Enable RLS
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON storage.objects;
DROP POLICY IF EXISTS "Allow public read access to status screenshots" ON storage.objects;
DROP POLICY IF EXISTS "Enable upload to status_screenshot folder" ON storage.objects;

-- Create new policies with correct bucket name
CREATE POLICY "Enable read access for all users"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'status-screenshot');

CREATE POLICY "Enable insert access for all users"
ON storage.objects FOR INSERT
TO public
WITH CHECK (bucket_id = 'status-screenshot');

CREATE POLICY "Enable update access for all users"
ON storage.objects FOR UPDATE
TO public
USING (bucket_id = 'status-screenshot');

CREATE POLICY "Enable delete access for all users"
ON storage.objects FOR DELETE
TO public
USING (bucket_id = 'status-screenshot');
