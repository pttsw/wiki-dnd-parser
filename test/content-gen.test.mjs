import test from 'node:test';
import assert from 'node:assert/strict';

import { parseContent } from '../src/contentGen.js';

test('parseContent handles inline, image, and statblockInline paragraph types without logging errors', () => {
  const originalError = console.error;
  const errors = [];
  console.error = (...args) => {
    errors.push(args.map(arg => String(arg)).join(' '));
  };

  try {
    const html = parseContent([
      {
        type: 'inline',
        entries: [
          'Alternatively, see the ',
          {
            type: 'link',
            href: { type: 'internal', path: 'statgen.html', hash: 'pointbuy' },
            text: 'Point Buy Calculator.',
          },
        ],
      },
      {
        type: 'image',
        href: { type: 'internal', path: 'deities/MOT/025-02-04.webp' },
        title: 'Athreos',
        credit: 'Ryan Barger',
      },
      {
        type: 'statblockInline',
        dataType: 'object',
        data: {
          name: 'Joho',
          source: 'ToA',
          page: 179,
        },
      },
      {
        type: 'insetReadaloud',
        name: 'Myths of Athreos',
        entries: ['Athreos eternally performs a remarkable labor.'],
      },
    ]);

    assert.equal(errors.length, 0);
    assert.match(html, /Point Buy Calculator\./);
    assert.match(html, /href="statgen\.html#pointbuy"/);
    assert.match(html, /parser-image/);
    assert.match(html, /deities\/MOT\/025-02-04\.webp/);
    assert.match(html, /Athreos/);
    assert.match(html, /Ryan Barger/);
    assert.match(html, /parser-statblock-inline/);
    assert.match(html, /Joho/);
    assert.match(html, /object/);
    assert.match(html, /parser-inset-readaloud/);
    assert.match(html, /Myths of Athreos/);
  } finally {
    console.error = originalError;
  }
});
