-- A singleton slot replaces prior pushes without racing updates to catalog flags.
CREATE TABLE IF NOT EXISTS halo_dj_shop_featured (
  slot TEXT PRIMARY KEY DEFAULT 'featured' CHECK (slot = 'featured'),
  mix_id TEXT NOT NULL REFERENCES halo_mixes(id) ON DELETE CASCADE,
  push_priority TEXT NOT NULL DEFAULT 'featured'
    CHECK (push_priority IN ('featured', 'white_label', 'test_press'))
);
