import { describe, expect, it } from 'vitest';
import { validateIpcArgs } from '../ipc-validators.js';

describe('ipc-validators', () => {
  it('accepts valid chat:send payload', () => {
    expect(() => {
      validateIpcArgs('chat:send', [{}, 'session-1', 'hello', { mode: 'cli' }]);
    }).not.toThrow();
  });

  it('rejects unknown channel without schema', () => {
    expect(() => {
      validateIpcArgs('unknown:channel', [{}, 'value']);
    }).toThrow(/No IPC schema defined/);
  });

  it('accepts skills:import-local with safe path', () => {
    expect(() => {
      validateIpcArgs('skills:import-local', [{}, '/tmp/local-skill']);
    }).not.toThrow();
  });
});
