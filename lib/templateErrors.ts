export function createTemplateLoadError(localError: unknown, cloudError: unknown): Error {
  return new Error('تعذر تحميل القوالب من التخزين المحلي والخادم.', {
    cause: new AggregateError(
      [localError, cloudError],
      'Local and cloud template loading both failed.',
    ),
  });
}
