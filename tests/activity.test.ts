import { describe, expect, it } from 'vitest';
import { buildModel } from '../src/lib/model';
import { avatarSrc } from '../src/lib/urls';
import { sub } from './helpers';

describe('activity days', () => {
  it('keeps days with only rejected submissions or re-solves, separate from solve days', () => {
    const m = buildModel([
      sub({ at: '2025-01-01', index: 'A', verdict: 'WRONG_ANSWER' }),
      sub({ at: '2025-01-02', index: 'A', verdict: 'WRONG_ANSWER' }),
      sub({ at: '2025-01-02', index: 'A', verdict: 'OK' }),
      sub({ at: '2025-01-02', index: 'B', verdict: 'TIME_LIMIT_EXCEEDED' }),
      sub({ at: '2025-01-04', index: 'A', verdict: 'OK' }),
      sub({ at: '2025-01-05', contestId: 100500, index: 'C', verdict: 'OK' }),
    ]);
    expect([...m.days.keys()]).toEqual(['2025-01-02', '2025-01-05']);
    expect([...m.activity.keys()]).toEqual(['2025-01-01', '2025-01-02', '2025-01-04', '2025-01-05']);
    expect(m.activity.get('2025-01-01')).toMatchObject({ submissions: 1, others: [{ accepted: false }] });
    // A solved that day is listed with the solves, not again under "others".
    expect(m.activity.get('2025-01-02')!.submissions).toBe(3);
    expect(m.activity.get('2025-01-02')!.others.map((o) => o.problem.index)).toEqual(['B']);
    expect(m.activity.get('2025-01-04')!.others).toMatchObject([{ accepted: true }]);
    // Gym solves count like any other.
    expect(m.days.get('2025-01-05')!.count).toBe(1);
  });

  it('ignores submissions still being judged', () => {
    expect(buildModel([sub({ at: '2025-02-01', verdict: 'TESTING' })]).activity.size).toBe(0);
  });
});

describe('avatarSrc', () => {
  it('serves userpic files from codeforces.com', () => {
    expect(avatarSrc('https://userpic.codeforces.org/422/avatar/2b5dbe87f0d859a2.jpg')).toBe(
      'https://codeforces.com/userpic.codeforces.org/422/avatar/2b5dbe87f0d859a2.jpg',
    );
    expect(avatarSrc('//userpic.codeforces.org/no-avatar.jpg')).toBe('https://codeforces.com/userpic.codeforces.org/no-avatar.jpg');
  });

  it('rejects non-Codeforces and non-https URLs', () => {
    expect(avatarSrc('http://userpic.codeforces.org/a.jpg')).toBeNull();
    expect(avatarSrc('https://evil.example/a.jpg')).toBeNull();
    expect(avatarSrc(undefined)).toBeNull();
  });
});
