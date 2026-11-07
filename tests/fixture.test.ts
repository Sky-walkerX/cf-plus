/**
 * Optional real-data sanity check:
 *   CFX_FIXTURE=/path/to/user.status.json CFX_NOW=2026-11-07 npx vitest run tests/fixture.test.ts
 * Prints CF+ counters so they can be compared with the native profile counters.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { trimSubmission } from '../src/lib/cf-api';
import { activitySummary, buildModel } from '../src/lib/model';

const path = process.env.CFX_FIXTURE;

describe.skipIf(!path)('real data', () => {
  it('produces counters', () => {
    const raw = JSON.parse(readFileSync(path!, 'utf8')).result;
    const model = buildModel(raw.map(trimSubmission));
    const now = process.env.CFX_NOW ? new Date(`${process.env.CFX_NOW}T12:00:00`) : new Date();
    const s = activitySummary(model, now);
    const noDedupe = new Set(raw.filter((r: any) => r.verdict === 'OK').map((r: any) => `${r.problem.contestId}-${r.problem.index}`)).size;
    process.stderr.write(JSON.stringify({ ...s, uniqueAcKeysWithoutMirrorDedupe: noDedupe, attempted: model.attempted.length }, null, 2) + "\n");
    expect(s.total).toBeGreaterThan(0);
  });
});
