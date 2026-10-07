// Agregador dos schemas Drizzle dos modulos (ADR-001 v1.5 OA-001). Cada modulo mantem o proprio
// schema em modules/<modulo>/infrastructure/schema.ts; FKs entre modulos ficam so no SQL.
export * from '../../modules/identity/infrastructure/schema.js';
export * from '../../modules/occurrences/infrastructure/schema.js';
export * from '../../modules/plans/infrastructure/schema.js';
export * from '../../modules/platform/infrastructure/schema.js';
export * from '../../modules/responses/infrastructure/schema.js';
