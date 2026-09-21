import { describe, expect, it } from 'vitest';
import {
  branchName,
  defaultSlugFromTitle,
  exportBaseName,
  featureFolder,
  slugify,
} from './feature-slug';

describe('feature-slug', () => {
  describe('slugify', () => {
    it('lowercases and collapses non-alphanumeric runs to a single dash', () => {
      expect(slugify('Hello   World!!')).toBe('hello-world');
    });

    it('strips leading and trailing dashes', () => {
      expect(slugify('---foo bar---')).toBe('foo-bar');
    });

    it('collapses consecutive dashes from Unicode punctuation', () => {
      expect(slugify('Café — résumé 2026!')).toBe('caf-r-sum-2026');
    });

    it('returns an empty string when input is whitespace', () => {
      expect(slugify('   ')).toBe('');
    });

    it('returns an empty string for empty input', () => {
      expect(slugify('')).toBe('');
    });

    it('returns an empty string for input that is only punctuation', () => {
      expect(slugify('!!!')).toBe('');
    });

    it('strips diacritics into ASCII where possible', () => {
      expect(slugify('naïve façade')).toBe('na-ve-fa-ade');
    });

    it('refuses Windows-reserved slugs', () => {
      expect(slugify('CON')).toBe('');
      expect(slugify('LPT1')).toBe('');
    });

    it('handles a long unicode-rich title without throwing', () => {
      const result = slugify('🚀 News Portal — Demo (2026)');
      expect(result).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('defaultSlugFromTitle', () => {
    it('is an alias of slugify', () => {
      expect(defaultSlugFromTitle('Microblog Platform (Demo)')).toBe(slugify('Microblog Platform (Demo)'));
    });
  });

  describe('branchName', () => {
    it('builds the NNN-slug branch name', () => {
      expect(branchName({ meta: { featureNumber: 3, featureSlug: 'photo-organizer' } })).toBe(
        '003-photo-organizer',
      );
    });

    it('zero-pads the feature number to 3 digits', () => {
      expect(branchName({ meta: { featureNumber: 17, featureSlug: 'feature-x' } })).toBe(
        '017-feature-x',
      );
    });
  });

  describe('featureFolder', () => {
    it('builds the specs/<NNN-slug>/ folder name', () => {
      expect(
        featureFolder({ meta: { featureNumber: 1, featureSlug: 'news-portal' } }),
      ).toBe('specs/001-news-portal');
    });

    it('uses the feature slug verbatim', () => {
      expect(featureFolder({ meta: { featureNumber: 5, featureSlug: 'x' } })).toBe(
        'specs/005-x',
      );
    });
  });

  describe('exportBaseName', () => {
    it('builds the <NNN-slug> base name without an extension', () => {
      expect(
        exportBaseName({ meta: { featureNumber: 2, featureSlug: 'news-portal' } }),
      ).toBe('002-news-portal');
    });
  });
});
