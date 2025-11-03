import { useState } from 'react';
import React from 'react';
import type { TemplateInfo, UploadedFile } from '../lib/types';

type ImageVariantSelectionProps = {
  template: TemplateInfo;
  images: UploadedFile[];
  selectedVariants: Map<string, string[]>; // imageId -> variantIds[]
  onVariantToggle: (imageId: string, variantId: string) => void;
  onRemoveImage?: (imageId: string) => void;
};

export default function ImageVariantSelection({
  template,
  images,
  selectedVariants,
  onVariantToggle,
  onRemoveImage,
}: ImageVariantSelectionProps) {
  const [expandedImages, setExpandedImages] = useState<Set<string>>(new Set());
  
  const toggleAllVariants = (imageId: string, selectAll: boolean) => {
    template.variants.forEach(variant => {
      const current = selectedVariants.get(imageId) || [];
      const hasVariant = current.includes(variant.id);
      
      if (selectAll && !hasVariant) {
        onVariantToggle(imageId, variant.id);
      } else if (!selectAll && hasVariant) {
        onVariantToggle(imageId, variant.id);
      }
    });
  };

  const toggleExpanded = (imageId: string) => {
    const newExpanded = new Set(expandedImages);
    if (newExpanded.has(imageId)) {
      newExpanded.delete(imageId);
    } else {
      newExpanded.add(imageId);
    }
    setExpandedImages(newExpanded);
  };

  if (images.length === 0) {
    return (
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Template: {template.name}
        </h2>
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          Upload images to see them here
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          Template: {template.name}
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          All variants are selected by default. Click "Customize Variants" to change selection.
        </p>
      </div>

      <div className="overflow-x-auto overflow-y-auto">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr>
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Image
              </th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Variant Status
              </th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
            {images.map((image) => {
              const imageSelectedVariants = selectedVariants.get(image.fileId) || [];
              const allSelected = imageSelectedVariants.length === template.variants.length;
              const isExpanded = expandedImages.has(image.fileId);
              const variantCount = template.variants.length;
              const selectedCount = imageSelectedVariants.length;

              return (
                <React.Fragment key={image.fileId}>
                  <tr className="hover:bg-gray-50 dark:hover:bg-gray-700">
                    {/* Image Preview & Name */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center space-x-3">
                        <div className="flex-shrink-0">
                          <img
                            src={image.thumbnailUrl || image.publicUrl}
                            alt={image.originalName || image.fileId}
                            className="h-16 w-16 object-cover rounded-md border border-gray-300"
                          />
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-gray-900 dark:text-white truncate">
                            {image.originalName || image.fileId}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Variant Status */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      {allSelected ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          ✓ All {variantCount} variants
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                          {selectedCount} of {variantCount} variants
                        </span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3 whitespace-nowrap text-sm">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => toggleExpanded(image.fileId)}
                          className="text-indigo-700 bg-indigo-50 hover:bg-indigo-100 focus:ring-4 focus:outline-none focus:ring-indigo-300 font-medium rounded-lg text-sm px-4 py-2 dark:bg-indigo-800 dark:text-indigo-400 dark:hover:bg-indigo-900 dark:focus:ring-indigo-800"
                        >
                          {isExpanded ? 'Hide Options' : 'Customize Variants'}
                        </button>
                        {onRemoveImage && (
                          <button
                            type="button"
                            onClick={() => {
                              if (confirm(`Remove "${image.originalName || image.fileId}" from the upload?`)) {
                                onRemoveImage(image.fileId);
                              }
                            }}
                            className="text-red-700 bg-white border border-red-300 hover:bg-red-50 focus:ring-4 focus:outline-none focus:ring-red-200 font-medium rounded-lg text-sm px-4 py-2 dark:bg-gray-800 dark:text-red-400 dark:border-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-300 dark:focus:ring-red-800"
                            title="Remove image"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>

                  {/* Expandable Variant Selection Row */}
                  {isExpanded && (
                    <tr>
                      <td colSpan={3} className="p-0">
                        <div className="p-4 space-y-4">
                          <div className="flex items-center justify-between mb-3">
                            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                              Select which variants to include:
                            </h3>
                            <button
                              type="button"
                              onClick={() => toggleAllVariants(image.fileId, !allSelected)}
                              className="text-gray-900 bg-white border border-gray-300 hover:bg-gray-100 focus:ring-4 focus:outline-none focus:ring-gray-200 font-medium rounded-lg text-xs px-3 py-1.5 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-600 dark:hover:bg-gray-700 dark:hover:text-white dark:focus:ring-gray-700"
                            >
                              {allSelected ? 'Deselect All' : 'Select All'}
                            </button>
                          </div>

                          <ul className="w-full text-sm font-medium text-gray-900 bg-white border border-gray-200 rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                            {template.variants.map((variant, index) => {
                              const isSelected = imageSelectedVariants.includes(variant.id);
                              const placeholderCount = variant.placeholders.length;
                              const isLast = index === template.variants.length - 1;

                              return (
                                <li
                                  key={variant.id}
                                  className={`w-full border-b border-gray-200 dark:border-gray-600 ${isLast ? 'rounded-b-lg' : ''} ${index === 0 ? 'rounded-t-lg' : ''}`}
                                >
                                  <div className="flex items-center ps-3 pr-3">
                                    <input
                                      id={`variant-${image.fileId}-${variant.id}`}
                                      type="checkbox"
                                      checked={isSelected}
                                      onChange={() => onVariantToggle(image.fileId, variant.id)}
                                      className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded-sm focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-700 dark:focus:ring-offset-gray-700 focus:ring-2 dark:bg-gray-600 dark:border-gray-500 flex-shrink-0"
                                    />
                                    <label
                                      htmlFor={`variant-${image.fileId}-${variant.id}`}
                                      className="w-full py-3 ms-2 text-sm font-medium text-gray-900 dark:text-gray-300 cursor-pointer min-w-0"
                                    >
                                      <div className="flex items-center justify-between gap-4">
                                        <span className="truncate">{variant.name || variant.id}</span>
                                        <span className="text-xs font-normal text-gray-500 dark:text-gray-400 flex-shrink-0 whitespace-nowrap">
                                          {placeholderCount} placeholder{placeholderCount !== 1 ? 's' : ''}
                                        </span>
                                      </div>
                                    </label>
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}


