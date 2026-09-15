-- Fix invalid example.com URLs left over from previous seeds
UPDATE streamer_rewards 
SET image_url = 'https://images.unsplash.com/photo-1588850561407-ed78c282e89b?w=500&auto=format&fit=crop&q=60'
WHERE image_url LIKE '%example.com%';
