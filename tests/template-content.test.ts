import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractPlaceholders,
  getTemplateReadiness,
  hasPlaceholder,
  renderMessage,
  renderTemplatePreview,
} from '../lib/templateContent.ts';

test('extracts unique Arabic and English placeholders in appearance order', () => {
  assert.deepEqual(
    extractPlaceholders('Hello {{name}}, {{الاسم}}. Again {{name}}'),
    ['name', 'الاسم'],
  );
});

test('template is incomplete when a used placeholder has no valid mapping', () => {
  const readiness = getTemplateReadiness(
    'إشعار',
    'المبلغ {{المبلغ}}',
    {},
  );

  assert.deepEqual(readiness, {
    ready: false,
    missingVariables: ['المبلغ'],
  });
});

test('template readiness rejects mappings with blank source names', () => {
  const readiness = getTemplateReadiness(
    'إشعار',
    '{{المبلغ}}',
    { المبلغ: { type: 'column', column: '   ' } },
  );

  assert.deepEqual(readiness, {
    ready: false,
    missingVariables: ['المبلغ'],
  });

  test('detects an existing placeholder so binding does not insert it again', () => {
    assert.equal(hasPlaceholder('مرحباً {{الاسم}} من {{المبلغ}}', 'الاسم'), true);
    assert.equal(hasPlaceholder('مرحباً {{الاسم}}', 'المبلغ'), false);
  });
});

test('template is ready when every used placeholder has a valid mapping', () => {
  const readiness = getTemplateReadiness(
    'إشعار',
    '{{الاسم}} - {{المبلغ}}',
    {
      الاسم: { type: 'column', column: 'اسم العميل' },
      المبلغ: {
        type: 'pdf-region',
        region: { left: 0.1, top: 0.2, right: 0.4, bottom: 0.3 },
      },
    },
  );

  assert.deepEqual(readiness, { ready: true, missingVariables: [] });
});

test('preview keeps unresolved placeholders visible while rendering available samples', () => {
  const preview = renderTemplatePreview(
    'عزيزي {{الاسم}}، المبلغ {{المبلغ}} ريال.',
    { الاسم: 'أحمد مثال', المبلغ: '' },
  );

  assert.equal(preview.message, 'عزيزي أحمد مثال، المبلغ {{المبلغ}} ريال.');
  assert.deepEqual(preview.missingVariables, ['المبلغ']);
});

test('normal message rendering keeps its existing empty-string fallback', () => {
  assert.equal(renderMessage('المبلغ {{المبلغ}}', {}), 'المبلغ ');
});
