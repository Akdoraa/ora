import { describe, it, expect } from 'vitest';
import { LEDGER_MODULE } from './index';

describe('ledger', () => {
  it('exports module name', () => {
    expect(LEDGER_MODULE).toBe('@ora/ledger');
  });
});
