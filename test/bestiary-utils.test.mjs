import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getBestiaryId,
  hasLocalizedDifference,
  normalizeMonsterReferenceSources,
  resolveMonsterFluffContent,
  splitBestiaryRecord,
  toMonsterFluffContent,
} from '../src/bestiaryUtils.js';

test('getBestiaryId prefers ENG_name and falls back to name', () => {
  assert.equal(
    getBestiaryId({ ENG_name: 'Aarakocra', name: '鸟羽人', source: 'MM' }),
    'Aarakocra|MM'
  );
  assert.equal(
    getBestiaryId({ name: 'Aboleth', source: 'MM' }),
    'Aboleth|MM'
  );
});

test('normalizeMonsterReferenceSources keeps otherSources and fills missing page with zero', () => {
  assert.deepEqual(
    normalizeMonsterReferenceSources({
      otherSources: [{ source: 'PotA' }, { source: 'SKT', page: 12 }],
    }),
    [
      { source: 'PotA', page: 0 },
      { source: 'SKT', page: 12 },
    ]
  );
  assert.deepEqual(normalizeMonsterReferenceSources({}), []);
});

test('hasLocalizedDifference detects nested localized text in arrays and objects', () => {
  assert.equal(
    hasLocalizedDifference(
      [{ name: 'Dive Attack', entries: ['If the aarakocra dives...'] }],
      [{ ENG_name: 'Dive Attack', name: '俯冲攻击', entries: ['如果鸦人俯冲……'] }]
    ),
    true
  );
  assert.equal(
    hasLocalizedDifference(
      { hp: { average: 13, formula: '3d8' } },
      { hp: { average: 13, formula: '3d8' } }
    ),
    false
  );
});

test('splitBestiaryRecord keeps untranslated top-level keys in root and moves localized blocks to en/zh', () => {
  const en = {
    source: 'MM',
    page: 12,
    size: ['M'],
    action: [{ name: 'Talon', entries: ['Slash.'] }],
  };
  const zh = {
    ENG_name: 'Aarakocra',
    name: '鸟羽人',
    source: 'MM',
    page: 12,
    size: ['M'],
    action: [{ ENG_name: 'Talon', name: '禽爪', entries: ['挥砍。'] }],
  };

  const split = splitBestiaryRecord(en, zh, { skipKeys: ['name', 'ENG_name'] });

  assert.deepEqual(split.common, {
    source: 'MM',
    page: 12,
    size: ['M'],
  });
  assert.deepEqual(split.en, {
    action: [{ name: 'Talon', entries: ['Slash.'] }],
  });
  assert.deepEqual(split.zh, {
    action: [{ ENG_name: 'Talon', name: '禽爪', entries: ['挥砍。'] }],
  });
});

test('toMonsterFluffContent returns undefined for empty fluff and keeps entries/images when present', () => {
  assert.equal(toMonsterFluffContent(undefined), undefined);
  assert.equal(toMonsterFluffContent({ name: 'Aarakocra', source: 'MM' }), undefined);
  assert.deepEqual(
    toMonsterFluffContent({
      name: 'Aarakocra',
      source: 'MM',
      entries: [{ type: 'entries', entries: ['Lore'] }],
      images: [{ type: 'image', href: { type: 'internal', path: 'bestiary/MM/Aarakocra.webp' } }],
    }),
    {
      entries: [{ type: 'entries', entries: ['Lore'] }],
      images: [{ type: 'image', href: { type: 'internal', path: 'bestiary/MM/Aarakocra.webp' } }],
    }
  );
});

test('resolveMonsterFluffContent follows _copy chain for inherited fluff entries', () => {
  const fluffMap = new Map([
    [
      'Solar Dragon|BAM',
      {
        name: 'Solar Dragon',
        source: 'BAM',
        entries: [{ type: 'entries', entries: ['Solar lore'] }],
        images: [{ type: 'image', href: { type: 'internal', path: 'bestiary/BAM/Solar Dragon.webp' } }],
      },
    ],
    [
      'Adult Solar Dragon|BAM',
      {
        name: 'Adult Solar Dragon',
        source: 'BAM',
        _copy: {
          name: 'Solar Dragon',
          source: 'BAM',
        },
      },
    ],
  ]);

  assert.deepEqual(resolveMonsterFluffContent(fluffMap.get('Adult Solar Dragon|BAM'), fluffMap), {
    entries: [{ type: 'entries', entries: ['Solar lore'] }],
    images: [{ type: 'image', href: { type: 'internal', path: 'bestiary/BAM/Solar Dragon.webp' } }],
  });
});

test('resolveMonsterFluffContent applies _copy._mod array operations for fluff-only entries', () => {
  const fluffMap = new Map([
    [
      'Dragons|MM',
      {
        name: 'Dragons',
        source: 'MM',
        entries: [{ type: 'entries', entries: ['Base dragon lore'] }],
        images: [{ type: 'image', href: { type: 'internal', path: 'bestiary/MM/Dragons.webp' } }],
      },
    ],
    [
      'Chromatic Dragons|MM',
      {
        name: 'Chromatic Dragons',
        source: 'MM',
        _copy: {
          name: 'Dragons',
          source: 'MM',
          _mod: {
            entries: {
              mode: 'prependArr',
              items: { type: 'entries', entries: ['Chromatic lore'] },
            },
            images: {
              mode: 'appendArr',
              items: { type: 'image', href: { type: 'internal', path: 'bestiary/MM/Chromatic Dragons.webp' } },
            },
          },
        },
      },
    ],
  ]);

  assert.deepEqual(resolveMonsterFluffContent(fluffMap.get('Chromatic Dragons|MM'), fluffMap), {
    entries: [
      { type: 'entries', entries: ['Chromatic lore'] },
      { type: 'entries', entries: ['Base dragon lore'] },
    ],
    images: [
      { type: 'image', href: { type: 'internal', path: 'bestiary/MM/Dragons.webp' } },
      { type: 'image', href: { type: 'internal', path: 'bestiary/MM/Chromatic Dragons.webp' } },
    ],
  });
});
