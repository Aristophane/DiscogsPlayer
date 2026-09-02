/**
 * Schéma Drizzle — point d'entrée unique, un fichier par domaine.
 * Chaque lot ajoute son module et le réexporte ici (SPECIFICATION.md §24).
 */
export * from './auth';
export * from './catalog';
export * from './collection';
export * from './random';
export * from './tasks';
