/**
 * One-command verification that the new integrity path is active.
 *
 * Prerequisites: Copy auditor packs into apps/evidence-viewer/public/packs/
 * (e.g. from design_partner_bundle/packs/) so the demo loader can serve them.
 *
 * Run: pnpm --filter @pact/evidence-viewer test -- src/lib/__tests__/loadPack.integrity.test.ts
 *
 * A) Success pack: Integrity VALID; Hash chain VALID, Signatures x/x, Checksums VALID or UNAVAILABLE.
 * B) Tamper (derived output altered) pack: Integrity VALID or INDETERMINATE (no cryptographic tamper); warnings shown.
 */

import { describe, it, expect } from 'vitest';
import { loadPackFromFile } from '../loadPack';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const PUBLIC_PACKS = join(__dirname, '../../public/packs');
const SUCCESS_ZIP = join(PUBLIC_PACKS, 'auditor_pack_success.zip');
const CLAIM_MISMATCH_ZIP = join(PUBLIC_PACKS, 'auditor_pack_semantic_tampered.zip');

const hasSuccessPack = existsSync(SUCCESS_ZIP);
const hasClaimMismatchPack = existsSync(CLAIM_MISMATCH_ZIP);

function fileFromPath(filePath: string, name: string): File {
  const buf = readFileSync(filePath);
  return new File([buf], name, { type: 'application/zip' });
}

describe('Integrity path verification (loadPack → integrityResult)', () => {
  describe('A) Success pack', () => {
    it.skipIf(!hasSuccessPack)(
      'sets integrityResult: status VALID, hash chain VALID, signatures x/x verified, checksums VALID or UNAVAILABLE',
      { timeout: 15000 },
      async () => {
        const file = fileFromPath(SUCCESS_ZIP, 'auditor_pack_success.zip');
        const pack = await loadPackFromFile(file);

        expect(pack.integrityResult).toBeDefined();
        const ir = pack.integrityResult!;

        expect(ir.status).toBe('VALID');
        expect(ir.hashChain).toBeDefined();
        expect(ir.hashChain.status).toBe('VALID');
        expect(ir.signatures).toBeDefined();
        expect(ir.signatures.verifiedCount).toBe(ir.signatures.totalCount);
        expect(ir.signatures.totalCount).toBeGreaterThan(0);
        expect(['VALID', 'UNAVAILABLE']).toContain(ir.checksums.status);
      }
    );
  });

  describe('B) Tamper (derived output altered) pack', () => {
    it.skipIf(!hasClaimMismatchPack)(
      'sets integrityResult status VALID or INDETERMINATE (no cryptographic tamper); warnings may be present',
      { timeout: 15000 },
      async () => {
        const file = fileFromPath(CLAIM_MISMATCH_ZIP, 'auditor_pack_semantic_tampered.zip');
        const pack = await loadPackFromFile(file);

        expect(pack.integrityResult).toBeDefined();
        const ir = pack.integrityResult!;

        expect(['VALID', 'INDETERMINATE']).toContain(ir.status);
        expect(ir.status).not.toBe('TAMPERED');
      }
    );
  });
});
