export type PdfRegion = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  scope?: 'page' | 'rows';
};

export type TemplateVariableMapping =
  | {
      type: 'column';
      column: string;
    }
  | {
      type: 'pdf-region';
      region: PdfRegion;
    };

export type TemplateVariableMappings = Record<string, TemplateVariableMapping>;

export function pdfRegionColumnName(variable: string): string {
  return `__pdf_region__${variable}`;
}

export function isTemplateVariableMappings(value: unknown): value is TemplateVariableMappings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;

  return Object.entries(value).every(([name, mapping]) => {
    if (!name.trim() || typeof mapping !== 'object' || mapping === null || Array.isArray(mapping)) {
      return false;
    }

    if ('type' in mapping && mapping.type === 'column') {
      return 'column' in mapping &&
        typeof mapping.column === 'string' &&
        mapping.column.trim().length > 0;
    }

    if ('type' in mapping && mapping.type === 'pdf-region' && 'region' in mapping) {
      const region = mapping.region;
      if (typeof region !== 'object' || region === null) return false;
      if (!('left' in region) || !('top' in region) || !('right' in region) || !('bottom' in region)) {
        return false;
      }
      if (
        'scope' in region &&
        region.scope !== 'page' &&
        region.scope !== 'rows'
      ) {
        return false;
      }

      return (
        typeof region.left === 'number' &&
        typeof region.top === 'number' &&
        typeof region.right === 'number' &&
        typeof region.bottom === 'number' &&
        Number.isFinite(region.left) &&
        Number.isFinite(region.top) &&
        Number.isFinite(region.right) &&
        Number.isFinite(region.bottom) &&
        region.left >= 0 &&
        region.top >= 0 &&
        region.right <= 1 &&
        region.bottom <= 1 &&
        region.left < region.right &&
        region.top < region.bottom
      );
    }

    return false;
  });
}
