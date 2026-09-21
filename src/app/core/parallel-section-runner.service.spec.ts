import { TestBed } from '@angular/core/testing';
import { ParallelSectionRunner } from './parallel-section-runner.service';
import { ProjectStore } from './project.store';

describe('ParallelSectionRunner', () => {
  let runner: ParallelSectionRunner;
  let project: InstanceType<typeof ProjectStore>;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    runner = TestBed.inject(ParallelSectionRunner);
    project = TestBed.inject(ProjectStore);
  });

  it('runs N jobs concurrently (parallel path is faster than sequential on a synthetic 6-job fixture)', async () => {
    const jobCount = 6;
    const perJobDelayMs = 100;
    const invoker = async () => {
      await new Promise((r) => setTimeout(r, perJobDelayMs));
      return { text: '42' };
    };
    const parse = (raw: string) => ({ ok: true, value: Number(raw) });
    const validate = (value: unknown) => ({
      success: true as const,
      kind: 'layers' as const,
      data: value as number,
    });

    const start = Date.now();
    const result = await runner.run(
      Array.from({ length: jobCount }, (_, i) => ({
        id: `job-${i}`,
        buildPrompt: async () => ({
          format: async () => '42',
        }),
        validate,
      })),
      invoker,
      parse,
    );
    const parallelDuration = Date.now() - start;

    expect(result.error).toBeNull();
    expect(result.results.length).toBe(jobCount);
    expect(result.results.every((r) => r.error === null && r.value === 42)).toBe(true);



    const sequentialEstimate = jobCount * perJobDelayMs;
    expect(parallelDuration).toBeLessThan(sequentialEstimate * 0.6);
  });

  it('honours parallelSectionConcurrency cap from the store', async () => {
    project.setConfig({ ...project.config(), parallelSectionConcurrency: 1 });
    const inflight: number[] = [];
    let current = 0;
    let maxSeen = 0;
    const invoker = async () => {
      current += 1;
      maxSeen = Math.max(maxSeen, current);
      inflight.push(current);
      await new Promise((r) => setTimeout(r, 20));
      current -= 1;
      return { text: 'ok' };
    };
    const parse = (raw: string) => ({ ok: true, value: raw });
    const validate = (value: unknown) => ({
      success: true as const,
      kind: 'scaffold' as const,
      data: value as string,
    });

    await runner.run(
      Array.from({ length: 4 }, (_, i) => ({
        id: `j-${i}`,
        buildPrompt: async () => ({ format: async () => 'ok' }),
        validate,
      })),
      invoker,
      parse,
    );

    expect(maxSeen).toBe(1);
  });

  it('aggregates per-job failures into a single error', async () => {
    const invoker = async () => ({ text: 'not-json' });
    const parse = () => ({ ok: false, kind: 'malformed', position: 0, tail: '' });
    const validate = () => ({
      success: false as const,
      fields: ['(root)'],
      message: 'bad',
    });

    const result = await runner.run(
      [{ id: 'a', buildPrompt: async () => ({ format: async () => '' }), validate }],
      invoker,
      parse,
    );
    expect(result.error?.type).toBe('invalid_json');
  });

  it('retries each job up to maxAttemptsPerJob when validation fails, passing the previous error as retry hint', async () => {
    let call = 0;
    const invoker = async () => {
      call += 1;



      return { text: call === 1 ? '{not valid}' : '42' };
    };
    const parse = (raw: string) =>
      raw === '{not valid}'
        ? { ok: false as const, kind: 'malformed', position: 0, tail: '' }
        : { ok: true as const, value: Number(raw) };
    const validate = (value: unknown) => ({
      success: true as const,
      kind: 'layers' as const,
      data: value as number,
    });

    const seenHints: string[] = [];
    const result = await runner.run(
      [
        {
          id: 'a',
          buildPrompt: async (retryHint) => {
            seenHints.push(retryHint);
            return { format: async () => '' };
          },
          validate,
        },
      ],
      invoker,
      parse,
      { maxAttemptsPerJob: 2, repairOnFinalFailure: false },
    );
    expect(result.error).toBeNull();
    expect(result.attempts).toBe(2);
    expect(seenHints[0]).toBe('');
    expect(seenHints[1]).toMatch(/parser returned 'malformed'/);
  });

  it('returns a schema_validation error after exhausting per-job retries', async () => {
    let calls = 0;
    const invoker = async () => {
      calls += 1;
      return { text: JSON.stringify({ wrong: 'shape' }) };
    };
    const parse = (raw: string) => ({ ok: true as const, value: JSON.parse(raw) });
    const validate = () => ({
      success: false as const,
      fields: ['aggregate'],
      message: 'Layer chunk validation failed.',
    });

    const result = await runner.run(
      [
        {
          id: 'a',
          buildPrompt: async () => ({ format: async () => '' }),
          validate,
        },
      ],
      invoker,
      parse,
      { maxAttemptsPerJob: 2, repairOnFinalFailure: false },
    );
    expect(calls).toBe(2);
    expect(result.error?.type).toBe('schema_validation');
    expect(result.attempts).toBe(2);
  });

  it('attempts counter accumulates across concurrent jobs (not per-job)', async () => {
    let calls = 0;
    const invoker = async () => {
      calls += 1;
      return { text: JSON.stringify(42) };
    };
    const parse = (raw: string) => ({ ok: true as const, value: JSON.parse(raw) });
    const validate = (value: unknown) => ({
      success: true as const,
      kind: 'scaffold' as const,
      data: value as number,
    });

    const result = await runner.run(
      Array.from({ length: 4 }, (_, i) => ({
        id: `j-${i}`,
        buildPrompt: async () => ({ format: async () => '' }),
        validate,
      })),
      invoker,
      parse,
    );
    expect(calls).toBe(4);
    expect(result.attempts).toBe(4);
  });

  it('falls back to the JSON-repair prompt when the retry loop is exhausted', async () => {
    let call = 0;
    const invoker = async () => {
      call += 1;



      if (call <= 2) return { text: 'not-json-at-all' };
      return { text: JSON.stringify(42) };
    };
    const parse = (raw: string) =>
      raw.startsWith('not-json')
        ? { ok: false as const, kind: 'malformed', position: 0, tail: raw }
        : { ok: true as const, value: JSON.parse(raw) };
    const validate = (value: unknown) => ({
      success: true as const,
      kind: 'layers' as const,
      data: value as number,
    });

    const result = await runner.run(
      [
        {
          id: 'a',
          buildPrompt: async () => ({ format: async () => '' }),
          validate,
        },
      ],
      invoker,
      parse,
      { maxAttemptsPerJob: 2 },
    );
    expect(result.error).toBeNull();
    expect(result.attempts).toBe(3);
    expect(result.results[0].value).toBe(42);
  });

  it('skips the repair pass when repairOnFinalFailure is false', async () => {
    let calls = 0;
    const invoker = async () => {
      calls += 1;
      return { text: 'not-json-at-all' };
    };
    const parse = () => ({ ok: false as const, kind: 'malformed', position: 0, tail: '' });
    const validate = () => ({
      success: true as const,
      kind: 'layers' as const,
      data: 0,
    });

    const result = await runner.run(
      [{ id: 'a', buildPrompt: async () => ({ format: async () => '' }), validate }],
      invoker,
      parse,
      { maxAttemptsPerJob: 2, repairOnFinalFailure: false },
    );
    expect(calls).toBe(2);
    expect(result.attempts).toBe(2);
    expect(result.error?.type).toBe('invalid_json');
  });

  it('fires onJobError + onJobRetry hooks for failed attempts', async () => {
    let attempt = 0;
    const invoker = async () => {
      attempt += 1;
      return attempt === 1
        ? { text: 'not-json' }
        : { text: JSON.stringify({ id: 'a', ok: true }) };
    };
    const parse = (raw: string) => {
      if (raw.startsWith('{')) return { ok: true as const, value: { id: 'a', ok: true } };
      return { ok: false as const, kind: 'malformed' as const, position: 0, tail: '' };
    };
    const validate = (value: unknown) =>
      value && typeof value === 'object' && (value as { ok?: boolean }).ok
        ? ({ success: true as const, kind: 'layers' as const, data: 42 })
        : ({ success: false as const, fields: ['x: invalid'], message: 'bad' });

    const events: { hook: string; jobId?: string; kind?: string; attempt?: number; repairPass?: number }[] = [];
    const result = await runner.run(
      [{ id: 'a', buildPrompt: async () => ({ format: async () => '' }), validate }],
      invoker,
      parse,
      {
        maxAttemptsPerJob: 2,
        hooks: {
          onJobError: (e) => events.push({ hook: 'error', jobId: e.jobId, kind: e.kind, attempt: e.attempt }),
          onJobRetry: (e) => events.push({ hook: 'retry', jobId: e.jobId, attempt: e.attempt }),
          onJobRepair: (e) => events.push({ hook: 'repair', jobId: e.jobId, repairPass: e.repairPass }),
        },
      },
    );

    expect(result.results[0].value).toBe(42);
    expect(events.some((e) => e.hook === 'error' && e.kind === 'invalid_json')).toBe(true);
    expect(events.some((e) => e.hook === 'retry')).toBe(true);
    expect(events.every((e) => e.jobId === 'a')).toBe(true);
  });

  it('bails when the same parse failure signature repeats — no infinite loop on stuck output', async () => {
    let calls = 0;
    const invoker = async () => {
      calls += 1;



      return { text: 'this is not json' };
    };
    const parse = (raw: string) => ({
      ok: false as const,
      kind: 'malformed' as const,
      position: 0,
      tail: raw,
    });

    const result = await runner.run(
      [{ id: 'a', buildPrompt: async () => ({ format: async () => '' }), validate: () => ({ success: false as const, fields: [], message: 'x' }) }],
      invoker,
      parse,
      { maxAttemptsPerJob: 10, repairOnFinalFailure: false },
    );



    expect(calls).toBe(3);
    expect(result.results[0].error).not.toBeNull();
    expect(result.results[0].error?.type).toBe('invalid_json');
  });

  it('bails when the same provider error repeats (e.g. wrong API key)', async () => {
    let calls = 0;
    const invoker = async () => {
      calls += 1;
      throw new Error('401 Unauthorized');
    };
    const parse = (raw: string) => ({ ok: true as const, value: raw });
    const validate = (value: unknown) => ({ success: true as const, kind: 'layers' as const, data: value });

    const result = await runner.run(
      [{ id: 'a', buildPrompt: async () => ({ format: async () => '' }), validate }],
      invoker,
      parse,
      { maxAttemptsPerJob: 10, repairOnFinalFailure: false },
    );



    expect(calls).toBe(3);
    expect(result.results[0].error?.type).toBe('provider_error');
  });

  describe('truncation-aware retry hint (plan 1787600437867)', () => {
    it('sends the lean-skeleton hint when attempt 1 returned kind:"truncated" and attempt 2 succeeds', async () => {
      let call = 0;
      const invoker = async () => {
        call += 1;
        if (call === 1) {



          return { text: '{"id":"a","description":"cargo routing for logi' };
        }
        return { text: JSON.stringify({ id: 'a', description: 'cargo routing', ok: true }) };
      };
      const parse = (raw: string) => {
        if (raw.includes('cargo routing for logi')) {
          return { ok: false as const, kind: 'truncated', position: 40, tail: raw };
        }
        try {
          return { ok: true as const, value: JSON.parse(raw) };
        } catch {
          return { ok: false as const, kind: 'malformed', position: 0, tail: raw };
        }
      };
      const validate = (value: unknown) => {
        const v = value as { ok?: boolean };
        return v?.ok
          ? ({ success: true as const, kind: 'domains' as const, data: value })
          : ({ success: false as const, fields: ['id'], message: 'bad' });
      };

      const seenHints: string[] = [];
      const result = await runner.run(
        [
          {
            id: 'cargo-planning',
            buildPrompt: async (retryHint) => {
              seenHints.push(retryHint);
              return { format: async () => '' };
            },
            validate,
          },
        ],
        invoker,
        parse,
        { maxAttemptsPerJob: 2, repairOnFinalFailure: false },
      );

      expect(result.error).toBeNull();
      expect(result.attempts).toBe(2);
      expect(seenHints[0]).toBe('');



      expect(seenHints[1]).toContain('truncated by the model output limit');
      expect(seenHints[1]).toContain('aggregates');
    });

    it('sends the generic invalid-JSON hint when the failure is a syntax error (no truncation smell)', async () => {
      let call = 0;
      const invoker = async () => {
        call += 1;
        if (call === 1) {



          return { text: '{ id:"a" }' };
        }
        return { text: JSON.stringify({ id: 'a', ok: true }) };
      };
      const parse = (raw: string) => {
        if (raw === '{ id:"a" }') {
          return { ok: false as const, kind: 'malformed', position: 6, tail: raw };
        }
        try {
          return { ok: true as const, value: JSON.parse(raw) };
        } catch {
          return { ok: false as const, kind: 'malformed', position: 0, tail: raw };
        }
      };
      const validate = (value: unknown) => {
        const v = value as { ok?: boolean };
        return v?.ok
          ? ({ success: true as const, kind: 'domains' as const, data: value })
          : ({ success: false as const, fields: ['id'], message: 'bad' });
      };

      const seenHints: string[] = [];
      const result = await runner.run(
        [
          {
            id: 'a',
            buildPrompt: async (retryHint) => {
              seenHints.push(retryHint);
              return { format: async () => '' };
            },
            validate,
          },
        ],
        invoker,
        parse,
        { maxAttemptsPerJob: 2, repairOnFinalFailure: false },
      );

      expect(result.error).toBeNull();
      expect(seenHints[0]).toBe('');

      expect(seenHints[1]).not.toContain('truncated by the model output limit');
      expect(seenHints[1]).toMatch(/invalid JSON/);
    });
  });
});
