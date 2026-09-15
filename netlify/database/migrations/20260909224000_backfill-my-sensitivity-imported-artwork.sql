-- Keep "My Sensitivity Like a Crown" aligned with the current release artwork
-- contract on fresh deploys: when the seed populated only artwork_url, mirror that
-- asset into imported_artwork_url so catalog rendering resolves through the
-- imported-artwork slot without overwriting any later manual/imported artwork.
UPDATE halo_release_campaigns
SET
  imported_artwork_url = COALESCE(NULLIF(imported_artwork_url, ''), NULLIF(artwork_url, '')),
  updated_at = NOW()
WHERE id = 'my-sensitivity-like-a-crown'
  AND imported_artwork_url = ''
  AND artwork_url <> '';
