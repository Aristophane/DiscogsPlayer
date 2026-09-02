ALTER TABLE "discogs_releases" ADD COLUMN "title_normalized" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "discogs_releases" ADD COLUMN "artists_normalized" text DEFAULT '' NOT NULL;--> statement-breakpoint
-- Remplissage des lignes déjà importées, en reproduisant la normalisation applicative
-- (ligatures comprises : `æ` n'est pas décomposé par une simple suppression d'accents).
UPDATE "discogs_releases" SET
  "title_normalized" = trim(regexp_replace(
  lower(translate(
    replace(replace(replace(replace(replace(replace(coalesce("title", ''),
      'Æ','ae'),'æ','ae'),'Œ','oe'),'œ','oe'),'Ø','o'),'ø','o'),
    'àáâãäåçèéêëìíîïñòóôõöùúûüýÿÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝß',
    'aaaaaaceeeeiiiinooooouuuuyyAAAAAACEEEEIIIINOOOOOUUUUYs'
  )),
  '[^a-z0-9]+', ' ', 'g'
)),
  "artists_normalized" = trim(regexp_replace(
  lower(translate(
    replace(replace(replace(replace(replace(replace(coalesce("artists_text", ''),
      'Æ','ae'),'æ','ae'),'Œ','oe'),'œ','oe'),'Ø','o'),'ø','o'),
    'àáâãäåçèéêëìíîïñòóôõöùúûüýÿÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝß',
    'aaaaaaceeeeiiiinooooouuuuyyAAAAAACEEEEIIIINOOOOOUUUUYs'
  )),
  '[^a-z0-9]+', ' ', 'g'
));