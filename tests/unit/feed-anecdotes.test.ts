import { describe, expect, it } from 'vitest';
import { MIN_ANECDOTE_SCORE, selectWikipediaAnecdotes } from '@/modules/feed/anecdotes';

// Histoires synthétiques : ces artistes et événements ne représentent aucun fait réel.
const biography =
  'Orbite est un groupe de rock français fondé à Paris. Ses membres ont publié plusieurs albums et effectué des tournées en Europe.';
const recording =
  'Pendant l’enregistrement du disque, une panne de courant interrompt la séance. Le groupe décide de conserver le bruit de cet accident sur la bande et en fait le début du morceau.';
const artwork =
  'Pour la pochette du disque, le photographe veut saisir un oiseau devant le studio. Par hasard, un chien entre dans le cadre et le groupe décide de garder cette photo inattendue.';
const name =
  'Le nom du groupe est né d’une plaisanterie entre les musiciens. Un ami avait mal compris leur ancien nom sur une affiche et ce surnom inattendu finit par remplacer le nom officiel.';

describe('sélection des anecdotes Wikipédia', () => {
  it('choisit un incident de studio avant une introduction encyclopédique', () => {
    const article = `${biography}\n\n== Enregistrement ==\n\n${recording}`;
    const [selected] = selectWikipediaAnecdotes(article, 'album');
    expect(selected).toMatchObject({
      text: recording,
      section: 'Enregistrement',
      topic: 'recording',
    });
    expect(selected!.score).toBeGreaterThanOrEqual(MIN_ANECDOTE_SCORE);
  });

  it('cherche aussi les coulisses dans un article sur un artiste', () => {
    const article = `${biography}\n\n== Origine du nom ==\n\n${name}`;
    const [selected] = selectWikipediaAnecdotes(article, 'artist');
    expect(selected).toMatchObject({ text: name, section: 'Origine du nom', topic: 'name' });
    expect(selected!.score).toBeGreaterThanOrEqual(MIN_ANECDOTE_SCORE);
  });

  it('n’utilise pas de biographie générique quand aucune histoire ne se distingue', () => {
    const dates =
      'Le premier album paraît en 1981, suivi du deuxième en 1982 et du troisième en 1983. Le groupe publie ensuite quatre albums en 1984, 1985, 1986 et 1987.';
    expect(selectWikipediaAnecdotes(biography, 'artist')).toEqual([]);
    expect(selectWikipediaAnecdotes(dates, 'album')).toEqual([]);
    expect(selectWikipediaAnecdotes(`${biography}\n\n${dates}`, 'artist')).toEqual([]);
  });

  it('ne traite pas une liste de crédits ou de disques comme une anecdote', () => {
    const credits =
      '== Crédits ==\n\nProduction : Camille Exemple ; studio : Studio Exemple ; composition : Alex Exemple ; pochette : Dominique Exemple ; batterie : Claude Exemple ; basse : Jo Exemple.';
    const discography =
      '== Discographie ==\n\n1981 : Premier disque\n1982 : Deuxième disque\n1983 : Troisième disque\n1984 : Quatrième disque\n1985 : Cinquième disque\n1986 : Sixième disque';
    expect(selectWikipediaAnecdotes(credits, 'album')).toEqual([]);
    expect(selectWikipediaAnecdotes(discography, 'artist')).toEqual([]);
  });

  it('exclut les notes et références même si leur texte contient les bons mots-clés', () => {
    const article = `${biography}\n\n== Notes et références ==\n\n${recording}`;
    expect(selectWikipediaAnecdotes(article, 'artist')).toEqual([]);
  });

  it('exclut aussi les sous-sections des références et reprend aux sections suivantes', () => {
    const article = [
      biography,
      '== Notes et références ==',
      '=== Enregistrement ===',
      recording,
      '== Origine du nom ==',
      name,
    ].join('\n\n');
    const selected = selectWikipediaAnecdotes(article, 'artist');
    expect(selected.map(({ text }) => text)).toEqual([name]);
  });

  it('conserve un passage autonome plutôt qu’une conséquence privée de son contexte', () => {
    const isolated =
      'Ce dernier décide alors de conserver cette erreur dans le morceau. Cette décision inattendue transforme la séance en un souvenir amusant pour tous les musiciens du studio.';
    const article = `== Enregistrement ==\n\n${isolated}\n\n${recording}`;
    const selected = selectWikipediaAnecdotes(article, 'album');
    expect(selected.length).toBeGreaterThan(0);
    expect(selected[0]!.text).toBe(recording);
    expect(selected.every(({ text }) => !/^Ce dernier\b/.test(text))).toBe(true);
  });

  it('sélectionne également une histoire en anglais sans la traduire ni la réécrire', () => {
    const intro =
      'Orbit is a French rock band formed in Paris. Its members have released several studio albums and have toured extensively throughout Europe.';
    const incident =
      'During the recording session, a power failure accidentally stopped the tape machine. The band decided to keep the strange sound of the accident and used it as the opening of the song.';
    const article = `${intro}\n\n== Recording ==\n\n${incident}`;
    const [selected] = selectWikipediaAnecdotes(article, 'album', 'en');
    expect(selected).toMatchObject({ text: incident, section: 'Recording', topic: 'recording' });
    expect(selected!.score).toBeGreaterThanOrEqual(MIN_ANECDOTE_SCORE);
  });

  it('ne valorise pas un passage explicitement signalé comme non confirmé', () => {
    expect(
      selectWikipediaAnecdotes(`== Enregistrement ==\n\n${recording} [non confirmé]`, 'album'),
    ).toEqual([]);
    expect(
      selectWikipediaAnecdotes(
        '== Recording ==\n\nDuring recording, the producer accidentally brought a dog into the studio. The band decided to keep its barking as the introduction to their new song. [citation needed]',
        'artist',
        'en',
      ),
    ).toEqual([]);
  });

  it('rejette aussi les références souhaitées, les légendes et les hypothèses incertaines', () => {
    for (const marker of ['[réf. souhaitée]', '[référence nécessaire]'])
      expect(
        selectWikipediaAnecdotes(`== Enregistrement ==\n\n${recording} ${marker}`, 'album'),
      ).toEqual([]);
    for (const qualification of ['Selon la légende,', 'Probablement,'])
      expect(
        selectWikipediaAnecdotes(`== Enregistrement ==\n\n${qualification} ${recording}`, 'artist'),
      ).toEqual([]);
    expect(
      selectWikipediaAnecdotes(
        '== Recording ==\n\nDuring recording, the producer accidentally brought a dog into the studio. The band decided to keep its barking as the introduction to their new song. [reference necessary]',
        'artist',
        'en',
      ),
    ).toEqual([]);
  });

  it('ne confond pas le surnom d’un collaborateur avec une histoire du nom de l’artiste', () => {
    const timeline =
      'En 1965, le groupe engage Camille Exemple, surnommé le « Clapton de la vallée », et enregistre un nouvel album au Studio Exemple. Le disque paraît au printemps suivant.';
    expect(selectWikipediaAnecdotes(timeline, 'artist')).toEqual([]);
  });

  it('ne transforme pas une présentation élogieuse en anecdote sur une innovation', () => {
    const introduction =
      'Le groupe débute avec un premier album de rock expérimental, considéré comme pionnier du genre. Sa musique exerce ensuite une influence sur de nombreux artistes de la scène locale.';
    expect(selectWikipediaAnecdotes(introduction, 'artist')).toEqual([]);
  });

  it('exclut les incidents liés à la santé ou aux drogues de cette sélection divertissante', () => {
    const sensitive =
      'Lors d’un concert, Léo Exemple subit une crise après avoir consommé une drogue. Il arrache par surprise les cordes de sa guitare et le groupe improvise pour terminer le morceau.';
    expect(selectWikipediaAnecdotes(`== Concerts ==\n\n${sensitive}`, 'artist')).toEqual([]);
  });

  it('ne prend pas les paroles d’un refrain pour un récit inattendu', () => {
    const lyrics =
      'Lors du concert, le chanteur entonne le refrain : « J’ai tout oublié, mes chaussures et mon café, même le chien qui chantait ». Ces paroles sont ensuite reprises par le public.';
    expect(selectWikipediaAnecdotes(`== Chansons ==\n\n${lyrics}`, 'artist')).toEqual([]);
  });

  it('diversifie les thèmes et ne retourne pas deux fois le même passage', () => {
    const article = [
      biography,
      '== Enregistrement ==',
      recording,
      recording,
      '== Pochette ==',
      artwork,
      '== Origine du nom ==',
      name,
    ].join('\n\n');
    const selected = selectWikipediaAnecdotes(article, 'artist');
    expect(selected.length).toBeGreaterThanOrEqual(2);
    expect(selected.length).toBeLessThanOrEqual(3);
    expect(new Set(selected.map(({ text }) => text)).size).toBe(selected.length);
    expect(new Set(selected.map(({ topic }) => topic)).size).toBe(selected.length);
    expect(selected.every(({ text }) => [recording, artwork, name].includes(text))).toBe(true);
  });

  it('garde des phrases complètes et bornées sans ajouter de faits à un long paragraphe', () => {
    const longRecording = [
      recording,
      'Le producteur raconte que les musiciens ont d’abord cru la bande inutilisable et ont passé la soirée à chercher une solution avec le technicien du studio.',
      'Après plusieurs essais, le guitariste propose de jouer un accord pendant que le technicien remet la machine en marche, afin de reproduire ce son étrange.',
      'Le groupe écoute ensuite la prise dans une autre salle du studio et choisit de garder la première version, dont les défauts sont devenus une partie du morceau.',
      'La séance se termine tard dans la nuit, lorsque les musiciens trouvent enfin une manière de relier cet accident au reste de leur composition.',
    ].join(' ');
    expect(longRecording.length).toBeGreaterThan(680);
    const [selected] = selectWikipediaAnecdotes(
      `== Enregistrement ==\n\n${longRecording}`,
      'album',
    );
    expect(selected).toBeDefined();
    expect(selected!.text.length).toBeGreaterThanOrEqual(110);
    expect(selected!.text.length).toBeLessThanOrEqual(680);
    expect(selected!.text).toMatch(/[.!?][»”"']?$/);
    expect(longRecording).toContain(selected!.text);
    expect(selected!.text).not.toContain('…');
  });

  it('ne fabrique aucun texte pour un article vide ou trop court', () => {
    expect(selectWikipediaAnecdotes('', 'album')).toEqual([]);
    expect(selectWikipediaAnecdotes('Un accident de studio amusant.', 'artist')).toEqual([]);
  });
});
