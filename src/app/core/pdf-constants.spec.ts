import { STALE_VITE_DEPS_RE, isStaleViteDepsError } from './pdf-constants';

describe('pdf-constants', () => {
  describe('STALE_VITE_DEPS_RE', () => {
    it('matches a stale .angular/cache/.../vite/deps/...?v= path', () => {
      const path = '/.angular/cache/abc123/vite/deps/pdfmake_min.js?v=12345';
      expect(STALE_VITE_DEPS_RE.test(path)).toBe(true);
    });

    it('matches paths with extra folders between cache and vite/deps', () => {
      const path = '/.angular/cache/some-build-id/vite/deps/chunk-XYZ.js?v=deadbeef';
      expect(STALE_VITE_DEPS_RE.test(path)).toBe(true);
    });

    it('does not match a generic error message', () => {
      expect(STALE_VITE_DEPS_RE.test('TypeError: undefined is not a function')).toBe(false);
    });

    it('does not match a path missing the ?v= query string', () => {
      expect(STALE_VITE_DEPS_RE.test('/.angular/cache/abc/vite/deps/foo.js')).toBe(false);
    });

    it('does not match a path missing the vite/deps segment', () => {
      expect(STALE_VITE_DEPS_RE.test('/.angular/cache/abc/vite/other/foo.js?v=1')).toBe(false);
    });
  });

  describe('isStaleViteDepsError', () => {
    it('returns true for an Error whose message matches the regex', () => {
      const err = new Error('Failed to fetch /.angular/cache/abc/vite/deps/pdfmake.js?v=1');
      expect(isStaleViteDepsError(err)).toBe(true);
    });

    it('returns false for an Error with an unrelated message', () => {
      const err = new Error('Network down');
      expect(isStaleViteDepsError(err)).toBe(false);
    });

    it('returns false for null / undefined / primitives', () => {
      expect(isStaleViteDepsError(null)).toBe(false);
      expect(isStaleViteDepsError(undefined)).toBe(false);
      expect(isStaleViteDepsError(42)).toBe(false);
      expect(isStaleViteDepsError('plain string')).toBe(false);
    });

    it('returns false when the message field is not a string', () => {
      expect(isStaleViteDepsError({ message: 42 })).toBe(false);
    });
  });
});
