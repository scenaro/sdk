/**
 * Framework-agnostic entry point: session (headless), API client, and wire protocol.
 * React bindings live in `@scenaro/sdk/react` — import them from there so non-React
 * consumers never pull React into their bundle.
 */
export * from './protocol';
export * from './client';
export * from './core';

export const VERSION = '0.4.3';
