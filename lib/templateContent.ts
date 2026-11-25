import {
  isTemplateVariableMappings,
  type TemplateVariableMappings,
} from './templateMappings.ts';

const PLACEHOLDER_PATTERN = /\{\{\s*([\w\u0600-\u06FF\u0750-\u077F]+)\s*\}\}/g;

export type TemplateReadiness = {
  ready: boolean;
  missingVariables: string[];
};

export type TemplatePreview = {
  message: string;
  missingVariables: string[];
};

export function extractPlaceholders(body: string): string[] {
  const matches = body.matchAll(PLACEHOLDER_PATTERN);
  const seen = new Set<string>();
  const result: string[] = [];

  for (const match of matches) {
    const name = match[1];
    if (!seen.has(name)) {
      seen.add(name);
      result.push(name);
    }
  }

  return result;
}

export function hasPlaceholder(body: string, name: string): boolean {
  return extractPlaceholders(body).includes(name);
}

export function renderMessage(templateBody: string, data: Record<string, string>): string {
  return templateBody.replace(PLACEHOLDER_PATTERN, (_match, key: string) => {
    return data[key] !== undefined ? data[key] : '';
  });
}

export function getTemplateReadiness(
  title: string,
  body: string,
  mappings: TemplateVariableMappings,
): TemplateReadiness {
  const missingVariables = extractPlaceholders(body).filter((name) => {
    const mapping = mappings[name];
    return !mapping || !isTemplateVariableMappings({ [name]: mapping });
  });

  return {
    ready: title.trim().length > 0 && body.trim().length > 0 && missingVariables.length === 0,
    missingVariables,
  };
}

export function renderTemplatePreview(
  body: string,
  sampleValues: Record<string, string | undefined>,
): TemplatePreview {
  const placeholders = extractPlaceholders(body);
  const missingVariables = placeholders.filter((name) => {
    const value = sampleValues[name];
    return typeof value !== 'string' || value.trim().length === 0;
  });
  const values = Object.fromEntries(
    placeholders.map((name) => {
      const value = sampleValues[name];
      return [
        name,
        typeof value === 'string' && value.trim().length > 0 ? value : `{{${name}}}`,
      ];
    }),
  );

  return {
    message: renderMessage(body, values),
    missingVariables,
  };
}
