/**
 * Régulateur de débit pour les appels Discogs (SPECIFICATION.md §12.3, §9.4).
 *
 * Sans cadence, un worker à quatre tâches parallèles épuise la fenêtre Discogs en
 * quelques secondes puis prend une rafale de 429 : les tâches finissent par passer grâce
 * au backoff, mais l'import est lent et bruyant. §12.3 demande explicitement de
 * « s'arrêter temporairement avant d'atteindre zéro ».
 *
 * Le régulateur sérialise les appels d'un processus et espace chacun d'eux selon la
 * limite **annoncée par Discogs** (SYNC-008), jamais selon une constante devinée.
 */

/** Tant qu'aucun en-tête n'a été observé, on part d'une cadence prudente. */
const DEFAULT_INTERVAL_MS = 1_100;
const WINDOW_MS = 60_000;

/** En dessous de ce reste, on laisse la fenêtre se reconstituer avant de continuer. */
const LOW_REMAINING_THRESHOLD = 5;
const LOW_REMAINING_PAUSE_MS = 5_000;

export type PacerState = {
  intervalMs: number;
  nextAllowedAt: number;
};

export function createPacerState(): PacerState {
  return { intervalMs: DEFAULT_INTERVAL_MS, nextAllowedAt: 0 };
}

/**
 * Recalcule la cadence à partir des en-têtes de la dernière réponse.
 * Fonction pure : c'est elle qui porte la règle, et elle est testable seule.
 */
export function updatePacer(
  state: PacerState,
  rateLimit: { limit: number | null; remaining: number | null },
  now: number,
): PacerState {
  const intervalMs =
    rateLimit.limit && rateLimit.limit > 0
      ? Math.ceil(WINDOW_MS / rateLimit.limit)
      : state.intervalMs;

  // Fenêtre presque épuisée : on ne tente pas le dernier appel, on attend.
  const pause =
    rateLimit.remaining !== null && rateLimit.remaining <= LOW_REMAINING_THRESHOLD
      ? LOW_REMAINING_PAUSE_MS
      : intervalMs;

  return { intervalMs, nextAllowedAt: now + pause };
}

let state = createPacerState();
/** Chaîne de promesses : un seul appel Discogs en vol à la fois par processus. */
let chain: Promise<unknown> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Exécute `call` en respectant la cadence courante. Les appels concurrents sont mis en
 * file plutôt que rejetés : l'appelant n'a rien à savoir de la régulation.
 */
export function paced<T>(call: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    await sleep(state.nextAllowedAt - Date.now());
    return call();
  });

  // La chaîne ne doit jamais rester cassée par un échec : on la rétablit aussitôt.
  chain = run.then(
    () => undefined,
    () => undefined,
  );

  return run;
}

export function observeRateLimit(rateLimit: {
  limit: number | null;
  remaining: number | null;
}): void {
  state = updatePacer(state, rateLimit, Date.now());
}

/** Après un 429 : on ne retente rien avant le délai demandé par Discogs. */
export function observeRateLimited(retryAfterMs: number): void {
  state = { ...state, nextAllowedAt: Date.now() + retryAfterMs };
}

/** Réinitialisation, utilisée par les tests pour repartir d'un état connu. */
export function resetPacer(): void {
  state = createPacerState();
  chain = Promise.resolve();
}
