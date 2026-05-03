-- Adds post-import recalculation tracking used by /imports/*.
ALTER TABLE import_batches
    ADD COLUMN IF NOT EXISTS recalc_status TEXT NOT NULL DEFAULT 'PENDING';

ALTER TABLE import_batches
    ADD COLUMN IF NOT EXISTS recalc_error TEXT;

ALTER TABLE import_batches
    DROP CONSTRAINT IF EXISTS chk_import_recalc_status;

ALTER TABLE import_batches
    ADD CONSTRAINT chk_import_recalc_status
        CHECK (recalc_status IN ('PENDING', 'PROCESSING', 'COMPLETE', 'FAILED'));
