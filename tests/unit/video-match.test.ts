import { describe, expect, it } from 'vitest';

import {
  fallbackSingleVideoMatch,
  matchVideosToTracks,
  type TrackForMatch,
  type VideoCandidate,
} from '@/modules/catalog/video-match';

describe('matchVideosToTracks (§13.1, §15)', () => {
  it('apparie un titre de vidéo contenant le titre de la piste et l’artiste', () => {
    // Cas réel : "Altered Images - Don't Talk To Me About Love" → "Don't Talk To Me About Love"
    const tracks: TrackForMatch[] = [
      { id: 't1', title: "Don't Talk To Me About Love", durationSeconds: 200 },
    ];
    const videos: VideoCandidate[] = [
      { id: 'v1', title: "Altered Images - Don't Talk To Me About Love", durationSeconds: 201 },
    ];

    expect(matchVideosToTracks(tracks, videos)).toEqual([
      { trackId: 't1', videoId: 'v1', score: expect.any(Number) },
    ]);
  });

  it('rejette une vidéo live pour une piste studio (§15.2)', () => {
    const tracks: TrackForMatch[] = [{ id: 't1', title: 'Homogenic', durationSeconds: 200 }];
    const videos: VideoCandidate[] = [
      { id: 'v1', title: 'Björk - Homogenic (Live at Glastonbury)', durationSeconds: 210 },
    ];

    expect(matchVideosToTracks(tracks, videos)).toEqual([]);
  });

  it('accepte une vidéo live si la piste elle-même est un live', () => {
    const tracks: TrackForMatch[] = [{ id: 't1', title: 'Homogenic (Live)', durationSeconds: 200 }];
    const videos: VideoCandidate[] = [
      { id: 'v1', title: 'Björk - Homogenic (Live at Glastonbury)', durationSeconds: 210 },
    ];

    expect(matchVideosToTracks(tracks, videos)).toHaveLength(1);
  });

  it('n’attribue jamais deux fois la même vidéo à deux pistes', () => {
    const tracks: TrackForMatch[] = [
      { id: 't1', title: 'Intro', durationSeconds: 60 },
      { id: 't2', title: 'Intro Reprise', durationSeconds: 60 },
    ];
    const videos: VideoCandidate[] = [{ id: 'v1', title: 'Album - Intro', durationSeconds: 60 }];

    const results = matchVideosToTracks(tracks, videos);
    expect(results).toHaveLength(1);
  });

  it('préfère le meilleur score quand deux pistes concurrencent la même vidéo', () => {
    const tracks: TrackForMatch[] = [
      { id: 't1', title: 'Love', durationSeconds: 200 },
      { id: 't2', title: "Don't Talk To Me About Love", durationSeconds: 200 },
    ];
    const videos: VideoCandidate[] = [
      { id: 'v1', title: "Altered Images - Don't Talk To Me About Love", durationSeconds: 201 },
    ];

    const results = matchVideosToTracks(tracks, videos);
    expect(results).toEqual([{ trackId: 't2', videoId: 'v1', score: expect.any(Number) }]);
  });

  it('ignore une vidéo sans titre', () => {
    const tracks: TrackForMatch[] = [{ id: 't1', title: 'Track', durationSeconds: 100 }];
    const videos: VideoCandidate[] = [{ id: 'v1', title: null, durationSeconds: 100 }];

    expect(matchVideosToTracks(tracks, videos)).toEqual([]);
  });

  it('ne trouve rien sans recouvrement de mots suffisant', () => {
    const tracks: TrackForMatch[] = [{ id: 't1', title: 'Silence', durationSeconds: 100 }];
    const videos: VideoCandidate[] = [
      { id: 'v1', title: 'Artiste - Autre Chanson', durationSeconds: 100 },
    ];

    expect(matchVideosToTracks(tracks, videos)).toEqual([]);
  });
});

describe('fallbackSingleVideoMatch (cas courant : un simple avec une vidéo promo)', () => {
  it('attribue la vidéo unique à la première piste non appariée', () => {
    const tracks: TrackForMatch[] = [
      { id: 't1', title: 'Face A', durationSeconds: 200 },
      { id: 't2', title: 'Face B', durationSeconds: 200 },
    ];
    const videos: VideoCandidate[] = [
      { id: 'v1', title: 'Un clip promotionnel', durationSeconds: 200 },
    ];

    expect(fallbackSingleVideoMatch(tracks, videos, new Set())).toEqual({
      trackId: 't1',
      videoId: 'v1',
      score: 0,
    });
  });

  it('ne s’applique pas s’il y a plusieurs vidéos', () => {
    const tracks: TrackForMatch[] = [{ id: 't1', title: 'Face A', durationSeconds: 200 }];
    const videos: VideoCandidate[] = [
      { id: 'v1', title: 'Clip 1', durationSeconds: 200 },
      { id: 'v2', title: 'Clip 2', durationSeconds: 200 },
    ];

    expect(fallbackSingleVideoMatch(tracks, videos, new Set())).toBeNull();
  });

  it('ne s’applique pas si toutes les pistes sont déjà appariées', () => {
    const tracks: TrackForMatch[] = [{ id: 't1', title: 'Face A', durationSeconds: 200 }];
    const videos: VideoCandidate[] = [{ id: 'v1', title: 'Clip', durationSeconds: 200 }];

    expect(fallbackSingleVideoMatch(tracks, videos, new Set(['t1']))).toBeNull();
  });

  it('respecte le signal négatif même dans le repli', () => {
    const tracks: TrackForMatch[] = [{ id: 't1', title: 'Face A', durationSeconds: 200 }];
    const videos: VideoCandidate[] = [
      { id: 'v1', title: 'Face A (Karaoke Version)', durationSeconds: 200 },
    ];

    expect(fallbackSingleVideoMatch(tracks, videos, new Set())).toBeNull();
  });
});
