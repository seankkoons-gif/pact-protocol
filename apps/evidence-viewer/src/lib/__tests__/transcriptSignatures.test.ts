import { describe, it, expect } from 'vitest';
import { computeSignatureCounts } from '../transcriptSignatures';

describe('computeSignatureCounts', () => {
  it('returns UNAVAILABLE when transcript is null or undefined', () => {
    expect(computeSignatureCounts(null)).toEqual({
      totalCount: 0,
      verifiedCount: 0,
      status: 'UNAVAILABLE',
      failures: [],
    });
    expect(computeSignatureCounts(undefined)).toEqual({
      totalCount: 0,
      verifiedCount: 0,
      status: 'UNAVAILABLE',
      failures: [],
    });
  });

  it('returns UNAVAILABLE when rounds is missing or empty', () => {
    expect(computeSignatureCounts({})).toEqual({
      totalCount: 0,
      verifiedCount: 0,
      status: 'UNAVAILABLE',
      failures: [],
    });
    expect(computeSignatureCounts({ rounds: [] })).toEqual({
      totalCount: 0,
      verifiedCount: 0,
      status: 'UNAVAILABLE',
      failures: [],
    });
  });

  it('returns UNAVAILABLE when no round has signature.signature_b58', () => {
    expect(
      computeSignatureCounts({
        rounds: [
          { round_number: 0, round_type: 'INTENT', signature: {} },
          { round_number: 1, round_type: 'ASK', signature: { signer_public_key_b58: 'x' } },
        ],
      })
    ).toEqual({
      totalCount: 0,
      verifiedCount: 0,
      status: 'UNAVAILABLE',
      failures: [],
    });
  });

  it('returns INVALID and records failures when signature_b58 present but verify fails', () => {
    const result = computeSignatureCounts({
      rounds: [
        {
          round_number: 0,
          envelope_hash: '00'.repeat(32),
          public_key_b58: '2gVkY2W1xV2R2v2V2V2V2V2V2V2V2V2V2V2V2V2V2V2V',
          signature: {
            signature_b58: '3invalidbase58!!!',
            signer_public_key_b58: '2gVkY2W1xV2R2v2V2V2V2V2V2V2V2V2V2V2V2V2V2V2V',
          },
        },
      ],
    });
    expect(result.totalCount).toBe(1);
    expect(result.verifiedCount).toBe(0);
    expect(result.status).toBe('INVALID');
    expect(result.failures.length).toBe(1);
    expect(result.failures[0]).toMatch(/Round 0.*signature verification failed/);
  });
});
