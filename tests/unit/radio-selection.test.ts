import { describe, expect, it } from 'vitest';

import {
  selectRadioCandidate,
  type RadioCandidate,
  type RadioHistoryEntry,
} from '@/modules/radio/selection';

function candidate(id: string, overrides: Partial<RadioCandidate> = {}): RadioCandidate {
  return { trackId: id, releaseId: id, artistKey: id, recordingKey: id, videoId: id, ...overrides };
}

function played(track: RadioCandidate, day: number, sessionId = 'previous'): RadioHistoryEntry {
  return { ...track, sessionId, playedAt: new Date(Date.UTC(2026, 9, day)) };
}

describe('variété Radio', () => {
  it('préfère une piste locale jamais écoutée à un favori en cache', () => {
    const favorite = candidate('favorite');
    const fresh = candidate('fresh');
    expect(selectRadioCandidate([favorite, fresh], [played(favorite, 1)], 'current')?.trackId).toBe(
      'fresh',
    );
  });

  it('évite les titres au-delà des cinq dernières écoutes', () => {
    const tracks = Array.from({ length: 9 }, (_, i) => candidate(String(i)));
    const history = tracks.slice(0, 8).map((track, i) => played(track, 9 - i));
    expect(selectRadioCandidate(tracks, history, 'current')?.trackId).toBe('8');
  });

  it('espace les artistes même entre deux albums différents', () => {
    const recent = candidate('recent', { artistKey: 'same' });
    const sameArtist = candidate('another-album', { artistKey: 'same' });
    const differentArtist = candidate('different');
    expect(
      selectRadioCandidate([sameArtist, differentArtist], [played(recent, 1)], 'current')?.trackId,
    ).toBe('different');
  });

  it('espace les albums lorsque le filtre ne contient qu’un artiste', () => {
    const recent = candidate('recent', { artistKey: 'same', releaseId: 'album1' });
    const sameAlbum = candidate('another-track', { artistKey: 'same', releaseId: 'album1' });
    const otherAlbum = candidate('other', { artistKey: 'same', releaseId: 'album2' });
    expect(
      selectRadioCandidate([sameAlbum, otherAlbum], [played(recent, 1)], 'current')?.trackId,
    ).toBe('other');
  });

  it('rejoue le moins récemment écouté quand tout le petit périmètre a été joué', () => {
    const newest = candidate('newest');
    const oldest = candidate('oldest');
    expect(
      selectRadioCandidate([newest, oldest], [played(newest, 9), played(oldest, 1)], 'current')
        ?.trackId,
    ).toBe('oldest');
  });

  it('ne rejoue pas la même vidéo dans une session, même sous un autre titre', () => {
    const first = candidate('first');
    const alias = candidate('alias', { videoId: first.videoId });
    expect(selectRadioCandidate([alias], [played(first, 1, 'current')], 'current')).toBeNull();
  });

  it('reconnaît un même enregistrement sur deux éditions avec des vidéos différentes', () => {
    const first = candidate('first');
    const reissue = candidate('reissue', { recordingKey: first.recordingKey });
    expect(selectRadioCandidate([reissue], [played(first, 1, 'current')], 'current')).toBeNull();
  });

  it('permet de rejouer une collection à une seule piste dans une nouvelle session', () => {
    const track = candidate('only');
    expect(selectRadioCandidate([track], [played(track, 1)], 'current')).toEqual(track);
  });

  it('préfère les vidéos locales à une recherche lorsque les deux pistes sont nouvelles', () => {
    const local = candidate('local');
    expect(
      selectRadioCandidate([candidate('unknown', { videoId: null }), local], [], 'current'),
    ).toEqual(local);
  });

  it('ne donne pas plus de poids à un artiste dont l’album comporte vingt pistes', () => {
    const longAlbum = Array.from({ length: 20 }, (_, i) =>
      candidate(`long${i}`, {
        artistKey: 'long',
        releaseId: 'long',
      }),
    );
    const single = candidate('single');
    // Le tirage 0,75 doit sélectionner le second artiste, quelle que soit sa taille.
    expect(selectRadioCandidate([...longAlbum, single], [], 'current', () => 0.75)).toEqual(single);
  });
});
