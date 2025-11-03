import { useState, useEffect } from 'react';
import { createFromTemplate } from '../lib/api';
import RunSheet from '../components/RunSheet';
import type { TemplateInfo, UploadedFile, CreateFromTemplateBody, ProductCreationResult, PlaceholderAssignment, VariantAssignment } from '../lib/types';
import { toHeadlineCase } from '../lib/utils';

export default function Review() {
  const [template, setTemplate] = useState<TemplateInfo | null>(null);
  const [images, setImages] = useState<UploadedFile[]>([]);
  const [selectedVariants, setSelectedVariants] = useState<Map<string, string[]>>(new Map());
  const [metadata, setMetadata] = useState<Partial<CreateFromTemplateBody>>({});
  const [results, setResults] = useState<ProductCreationResult[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const storedTemplate = sessionStorage.getItem('template');
    const storedImages = sessionStorage.getItem('images');
    const storedVariants = sessionStorage.getItem('selectedVariants');
    const storedMetadata = sessionStorage.getItem('metadata');

    if (storedTemplate) setTemplate(JSON.parse(storedTemplate));
    if (storedImages) setImages(JSON.parse(storedImages));
    if (storedVariants) setSelectedVariants(new Map(JSON.parse(storedVariants)));
    if (storedMetadata) setMetadata(JSON.parse(storedMetadata));
  }, []);

  const createProducts = async () => {
    if (!template || images.length === 0) {
      alert('No template or images selected');
      return;
    }

    if (!metadata.description) {
      alert('Description is required');
      return;
    }

    setCreating(true);
    const newResults: ProductCreationResult[] = [];

    // Create one product per image
    for (const image of images) {
      const imageVariantIds = selectedVariants.get(image.fileId) || [];
      
      if (imageVariantIds.length === 0) {
        newResults.push({
          templateId: template.id,
          status: 'error',
          error: `No variants selected for image: ${image.originalName || image.fileId}`,
        });
        continue;
      }

      // Build variant assignments: map image to all placeholders in selected variants
      const variantAssignments: VariantAssignment[] = [];
      
      for (const variantId of imageVariantIds) {
        const variant = template.variants.find(v => v.id === variantId);
        if (!variant) continue;

        // Map the image to ALL placeholders in this variant
        const placeholders: PlaceholderAssignment[] = variant.placeholders.map(placeholder => ({
          name: placeholder.name,
          fileUrl: image.publicUrl,
          // fitMethod can be added if needed - defaults to 'slice' per API docs
        }));

        variantAssignments.push({
          templateVariantId: variantId,
          imagePlaceholders: placeholders,
        });
      }

      // Generate title: if metadata.title (prefix) is provided, use "prefix - filename", else just filename
      // Remove file extension and convert to Headline Case
      const rawImageName = (image.originalName || image.fileId).replace(/\.[^/.]+$/, '');
      const imageName = toHeadlineCase(rawImageName);
      const productTitle = metadata.title 
        ? `${metadata.title} - ${imageName}`
        : imageName;

      // Create product payload per API docs
      // Both title and description are REQUIRED per API docs
      const payload: CreateFromTemplateBody = {
        templateId: template.id,
        title: productTitle,
        description: metadata.description || 'Product description', // Fallback if somehow empty
        tags: metadata.tags,
        isVisibleInTheOnlineStore: metadata.isVisibleInTheOnlineStore,
        salesChannels: metadata.salesChannels,
        variants: variantAssignments,
      };

      newResults.push({
        templateId: template.id,
        status: 'pending',
      });

      setResults([...newResults]);

      try {
        // Official API response per docs: id, previewUrl, status, etc.
        const response = await createFromTemplate(payload) as any;
        
        const resultIndex = newResults.length - 1;
        newResults[resultIndex] = {
          templateId: template.id,
          status: 'success',
          productId: response.id || '',
          previewUrl: response.previewUrl || '',
          // Note: API docs show previewUrl but not adminUrl - check if it exists
          adminUrl: response.adminUrl || response.externalId || '',
        };
      } catch (err) {
        const resultIndex = newResults.length - 1;
        newResults[resultIndex] = {
          templateId: template.id,
          status: 'error',
          error: err instanceof Error ? err.message : 'Unknown error',
          errorDetails: err,
        };
      }

      setResults([...newResults]);

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    setCreating(false);
  };

  const handleRetry = async (index: number) => {
    const result = results[index];
    if (!result || result.status !== 'error' || !template) return;

    // Find the image that corresponds to this result
    const image = images[index];
    if (!image) return;

    const imageVariantIds = selectedVariants.get(image.fileId) || [];
    if (imageVariantIds.length === 0) return;

    // Rebuild the payload same as createProducts
    const variantAssignments: VariantAssignment[] = [];
    
    for (const variantId of imageVariantIds) {
      const variant = template.variants.find(v => v.id === variantId);
      if (!variant) continue;

      const placeholders: PlaceholderAssignment[] = variant.placeholders.map(placeholder => ({
        name: placeholder.name,
        fileUrl: image.publicUrl,
      }));

      variantAssignments.push({
        templateVariantId: variantId,
        imagePlaceholders: placeholders,
      });
    }

    // Generate title: if metadata.title (prefix) is provided, use "prefix - filename", else just filename
    // Remove file extension and convert to Headline Case
    const rawImageName = (image.originalName || image.fileId).replace(/\.[^/.]+$/, '');
    const imageName = toHeadlineCase(rawImageName);
    const productTitle = metadata.title 
      ? `${metadata.title} - ${imageName}`
      : imageName;

    const payload: CreateFromTemplateBody = {
      templateId: template.id,
      title: productTitle,
      description: metadata.description || 'Product description', // Fallback if somehow empty
      tags: metadata.tags,
      isVisibleInTheOnlineStore: metadata.isVisibleInTheOnlineStore,
      salesChannels: metadata.salesChannels,
      variants: variantAssignments,
    };

    const newResults = [...results];
    newResults[index] = {
      ...result,
      status: 'pending',
    };
    setResults(newResults);

    try {
      const response = await createFromTemplate(payload) as any;
      
      newResults[index] = {
        templateId: template.id,
        status: 'success',
        productId: response.id || '',
        previewUrl: response.previewUrl || '',
        adminUrl: response.adminUrl || response.externalId || '',
      };
    } catch (err) {
      newResults[index] = {
        ...result,
        status: 'error',
        error: err instanceof Error ? err.message : 'Unknown error',
        errorDetails: err,
      };
    }

    setResults(newResults);
  };

  if (!template) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-500">No template selected. Please go back and select a template.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white shadow rounded-lg p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Review & Upload to Gelato</h2>
        
        <div className="space-y-4">
          <div>
            <strong>Template:</strong> {template.name}
          </div>
          <div>
            <strong>Images:</strong> {images.length}
          </div>
          <div>
            <strong>Title Prefix:</strong> {metadata.title ? `"${metadata.title}" (will be combined with image filename)` : 'None (using image filename only)'}
          </div>
          <div>
            <strong>Description:</strong> {metadata.description || 'Not set'}
          </div>
          <div>
            <strong>Products to Create:</strong> {images.length} (one per image)
            <div className="text-xs text-gray-500 mt-1">
              Each product will use: {metadata.title ? `"${metadata.title} - [Image Name]"` : '"[Image Name]"'} as title
            </div>
          </div>
        </div>

        <div className="mt-6">
          <button
            type="button"
            onClick={createProducts}
            disabled={creating || images.length === 0 || !metadata.description}
            className="text-white bg-gray-900 dark:bg-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-100 focus:ring-4 focus:outline-none focus:ring-gray-300 dark:focus:ring-gray-700 font-medium rounded-lg text-sm px-5 py-2.5 text-center disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {creating ? 'Uploading to Gelato...' : 'Upload to Gelato'}
          </button>
        </div>
      </div>

      <RunSheet results={results} images={images} onRetry={handleRetry} />
    </div>
  );
}

