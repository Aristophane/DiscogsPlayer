-- pg_trgm : requis par l'index GIN de recherche « contient » ci-dessous.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
ALTER TABLE "discogs_releases" ADD COLUMN "search_text" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX "discogs_releases_search_text_idx" ON "discogs_releases" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
-- Remplissage des lignes déjà importées : sans cela, la recherche ne verrait que les
-- éditions synchronisées après cette migration. `unaccent` n'étant pas garanti, on
-- reproduit la normalisation applicative avec translate().
UPDATE "discogs_releases"
SET "search_text" = trim(regexp_replace(
  lower(translate(
    coalesce("title", '') || ' ' || coalesce("artists_text", ''),
    'àáâãäåçèéêëìíîïñòóôõöùúûüýÿÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝ',
    'aaaaaaceeeeiiiinooooouuuuyyAAAAAACEEEEIIIINOOOOOUUUUY'
  )),
  '[^a-z0-9]+', ' ', 'g'
));