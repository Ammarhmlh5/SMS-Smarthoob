import test from 'node:test';
import assert from 'node:assert/strict';
import { createTemplateLoadError } from '../lib/templateErrors.ts';
import { decodeTemplateRecord } from '../lib/templateRecord.ts';

const baseTemplate = {
  id: 'template-1',
  title: 'قالب إشعار',
  body: 'مرحبًا {{الاسم}}',
  created_at: '2026-11-24T00:00:00.000Z',
  updated_at: '2026-11-24T00:00:00.000Z',
};

test('decodes SQLite flags and JSON mappings without losing pending status', () => {
  const template = decodeTemplateRecord({
    ...baseTemplate,
    is_default: 1,
    sync_status: 'pending',
    variable_mappings: JSON.stringify({
      الاسم: { type: 'column', column: 'اسم العميل' },
    }),
  });

  assert.equal(template.is_default, true);
  assert.equal(template.sync_status, 'pending');
  assert.deepEqual(template.variable_mappings, {
    الاسم: { type: 'column', column: 'اسم العميل' },
  });
});

test('keeps legacy templates with missing mappings compatible', () => {
  const template = decodeTemplateRecord(baseTemplate);

  assert.deepEqual(template.variable_mappings, {});
  assert.equal(template.is_default, false);
  assert.equal(template.sync_status, undefined);
});

test('assigns a synced status to rows read directly from the cloud', () => {
  const template = decodeTemplateRecord(baseTemplate, 'synced');

  assert.equal(template.sync_status, 'synced');
});

test('rejects malformed mapping JSON instead of dropping the template', () => {
  assert.throws(
    () => decodeTemplateRecord({ ...baseTemplate, variable_mappings: '{invalid' }),
    /تعذر قراءة بيانات ربط متغيرات القالب/,
  );
});

test('rejects invalid mappings and malformed required fields', () => {
  assert.throws(
    () => decodeTemplateRecord({
      ...baseTemplate,
      variable_mappings: JSON.stringify({ الاسم: { type: 'column', column: '  ' } }),
    }),
    /بيانات ربط متغيرات القالب غير صالحة/,
  );
  assert.throws(
    () => decodeTemplateRecord({ ...baseTemplate, title: null }),
    /بيانات القالب لا تحتوي على الحقول المطلوبة/,
  );
});

test('rejects unknown sync and default statuses', () => {
  assert.throws(
    () => decodeTemplateRecord({ ...baseTemplate, sync_status: 'failed' }),
    /حالة مزامنة القالب غير صالحة/,
  );
  assert.throws(
    () => decodeTemplateRecord({ ...baseTemplate, is_default: 'yes' }),
    /قيمة تصنيف القالب الافتراضي غير صالحة/,
  );
});

test('preserves both SQLite and cloud failures when template loading falls back', () => {
  const localError = new Error('SQLite unavailable');
  const cloudError = new Error('API unavailable');
  const loadError = createTemplateLoadError(localError, cloudError);
  const causes = loadError.cause;

  assert.equal(loadError.message, 'تعذر تحميل القوالب من التخزين المحلي والخادم.');
  assert.ok(causes instanceof AggregateError);
  assert.deepEqual(causes.errors, [localError, cloudError]);
});
