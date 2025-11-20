import type { CreateFromTemplateBody, TemplateVariant } from './types';

export function validateProductCreation(
  body: CreateFromTemplateBody,
  variants: TemplateVariant[]
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!body.templateId) {
    errors.push('Template ID is required');
  }

  if (!body.title || body.title.trim().length === 0) {
    errors.push('Title is required');
  }

  if (!body.description || body.description.trim().length === 0) {
    errors.push('Description is required');
  }

  if (!body.variants || body.variants.length === 0) {
    errors.push('At least one variant must be selected');
  }

  // Validate each variant has all required placeholders
  for (const variant of body.variants) {
    const templateVariant = variants.find(v => v.id === variant.templateVariantId);
    if (!templateVariant) {
      errors.push(`Variant ${variant.templateVariantId} not found in template`);
      continue;
    }

    for (const placeholder of templateVariant.placeholders) {
      const assignment = variant.imagePlaceholders.find(
        p => p.name === placeholder.name
      );
      if (!assignment || !assignment.fileUrl) {
        errors.push(
          `Variant ${templateVariant.name || variant.templateVariantId} missing image for placeholder "${placeholder.name}"`
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export async function checkImageResolution(
  file: File,
  placeholderWidth?: number,
  placeholderHeight?: number,
  dpi: number = 300
): Promise<{ sufficient: boolean; warning?: string }> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    
    img.onload = () => {
      URL.revokeObjectURL(url);
      
      if (!placeholderWidth || !placeholderHeight) {
        resolve({ sufficient: true });
        return;
      }

      // Convert placeholder size to pixels at specified DPI
      const requiredWidth = Math.ceil((placeholderWidth / 25.4) * dpi); // mm to inches, then DPI
      const requiredHeight = Math.ceil((placeholderHeight / 25.4) * dpi);

      const sufficient = img.width >= requiredWidth && img.height >= requiredHeight;
      
      if (!sufficient) {
        resolve({
          sufficient: false,
          warning: `Image (${img.width}x${img.height}px) may be below recommended resolution (${requiredWidth}x${requiredHeight}px at ${dpi} DPI)`,
        });
      } else {
        resolve({ sufficient: true });
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ sufficient: true }); // Don't block on decode errors
    };

    img.src = url;
  });
}

export function generateCSV(results: Array<{
  templateId: string;
  status: string;
  productId?: string;
  previewUrl?: string;
  adminUrl?: string;
  error?: string;
}>): string {
  const headers = ['Template ID', 'Status', 'Product ID', 'Preview URL', 'Admin URL', 'Error'];
  const rows = results.map(r => [
    r.templateId,
    r.status,
    r.productId || '',
    r.previewUrl || '',
    r.adminUrl || '',
    r.error || '',
  ]);

  const csv = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
  ].join('\n');

  return csv;
}

export function downloadCSV(csv: string, filename: string = 'gelato-upload-results.csv'): void {
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

