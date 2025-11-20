import { useState } from 'react';
import type { TemplateInfo, UploadedFile, VariantAssignment } from '../lib/types';

type MappingGridProps = {
  templates: TemplateInfo[];
  uploadedFiles: UploadedFile[];
  selectedVariants: string[];
  onVariantsChange: (variantIds: string[]) => void;
  onMappingChange: (mapping: Map<string, VariantAssignment>) => void;
};

export default function MappingGrid({
  templates,
  uploadedFiles,
  selectedVariants,
  onVariantsChange,
  onMappingChange,
}: MappingGridProps) {
  const [mapping, setMapping] = useState<Map<string, VariantAssignment>>(new Map());
  const [fitMethods, setFitMethods] = useState<Map<string, 'slice' | 'meet'>>(new Map());

  const updateMapping = (
    templateId: string,
    variantId: string,
    placeholderName: string,
    fileUrl: string
  ) => {
    const key = `${templateId}:${variantId}`;
    const current = mapping.get(key) || {
      templateVariantId: variantId,
      imagePlaceholders: [],
    };

    const placeholders = current.imagePlaceholders.filter(p => p.name !== placeholderName);
    placeholders.push({
      name: placeholderName,
      fileUrl,
      fitMethod: fitMethods.get(`${key}:${placeholderName}`),
    });

    const newAssignment: VariantAssignment = {
      templateVariantId: variantId,
      imagePlaceholders: placeholders,
    };

    const newMapping = new Map(mapping);
    newMapping.set(key, newAssignment);
    setMapping(newMapping);
    onMappingChange(newMapping);
  };

  const toggleVariant = (variantId: string) => {
    if (selectedVariants.includes(variantId)) {
      onVariantsChange(selectedVariants.filter(id => id !== variantId));
    } else {
      onVariantsChange([...selectedVariants, variantId]);
    }
  };

  const applyAutoMapping = () => {
    // Auto-map based on filename patterns
    const newMapping = new Map(mapping);
    
    for (const template of templates) {
      for (const variant of template.variants) {
        if (!selectedVariants.includes(variant.id)) continue;
        
        const key = `${template.id}:${variant.id}`;
        const current = newMapping.get(key) || {
          templateVariantId: variant.id,
          imagePlaceholders: [],
        };

        const placeholders = [...current.imagePlaceholders];

        for (const placeholder of variant.placeholders) {
          if (placeholders.find(p => p.name === placeholder.name)) continue;

          // Try to find matching file by name
          const matchingFile = uploadedFiles.find(file => {
            const name = file.originalName?.toLowerCase() || '';
            const placeholderLower = placeholder.name.toLowerCase();
            return (
              name.includes(placeholderLower) ||
              name.includes('front') && placeholderLower.includes('front') ||
              name.includes('back') && placeholderLower.includes('back') ||
              name.includes('left') && placeholderLower.includes('left') ||
              name.includes('right') && placeholderLower.includes('right')
            );
          });

          if (matchingFile) {
            placeholders.push({
              name: placeholder.name,
              fileUrl: matchingFile.publicUrl,
              fitMethod: fitMethods.get(`${key}:${placeholder.name}`),
            });
          }
        }

        if (placeholders.length > 0) {
          newMapping.set(key, {
            templateVariantId: variant.id,
            imagePlaceholders: placeholders,
          });
        }
      }
    }

    setMapping(newMapping);
    onMappingChange(newMapping);
  };

  return (
    <div className="bg-white shadow rounded-lg p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Map Artwork to Placeholders</h2>
        <button
          onClick={applyAutoMapping}
          className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 text-sm"
        >
          Auto-Map by Filename
        </button>
      </div>

      <div className="space-y-6">
        {templates.map((template) => (
          <div key={template.id} className="border border-gray-200 rounded-lg p-4">
            <h3 className="font-medium text-gray-900 mb-3">{template.name}</h3>
            
            <div className="space-y-4">
              {template.variants.map((variant) => (
                <div key={variant.id} className="border border-gray-100 rounded-md p-3">
                  <label className="flex items-center space-x-2 mb-3">
                    <input
                      type="checkbox"
                      checked={selectedVariants.includes(variant.id)}
                      onChange={() => toggleVariant(variant.id)}
                      className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="font-medium text-sm text-gray-700">
                      {variant.name || variant.id}
                    </span>
                  </label>

                  {selectedVariants.includes(variant.id) && (
                    <div className="space-y-2 ml-6">
                      {variant.placeholders.map((placeholder) => {
                        const currentMapping = mapping.get(`${template.id}:${variant.id}`);
                        const assignedFile = currentMapping?.imagePlaceholders.find(
                          p => p.name === placeholder.name
                        );

                        return (
                          <div key={placeholder.name} className="flex items-center space-x-3">
                            <div className="flex-1 min-w-0">
                              <label className="block text-xs font-medium text-gray-700 mb-1">
                                {placeholder.name}
                                {placeholder.size && (
                                  <span className="text-gray-500 ml-1">
                                    ({placeholder.size.width}×{placeholder.size.height} {placeholder.size.unit})
                                  </span>
                                )}
                              </label>
                              <select
                                value={assignedFile?.fileUrl || ''}
                                onChange={(e) => {
                                  if (e.target.value) {
                                    updateMapping(template.id, variant.id, placeholder.name, e.target.value);
                                  }
                                }}
                                className="w-full px-2 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                              >
                                <option value="">Select image...</option>
                                {uploadedFiles.map((file) => (
                                  <option key={file.fileId} value={file.publicUrl}>
                                    {file.originalName || file.fileId}
                                  </option>
                                ))}
                              </select>
                            </div>
                            
                            {/* Fit method - only show if API supports it */}
                            <div className="w-32">
                              <label className="block text-xs font-medium text-gray-700 mb-1">
                                Fit Method
                              </label>
                              <select
                                value={fitMethods.get(`${template.id}:${variant.id}:${placeholder.name}`) || 'meet'}
                                onChange={(e) => {
                                  const fitMethod = e.target.value as 'slice' | 'meet';
                                  const fitKey = `${template.id}:${variant.id}:${placeholder.name}`;
                                  setFitMethods(new Map(fitMethods).set(fitKey, fitMethod));
                                  
                                  // Update mapping with new fit method
                                  const mappingKey = `${template.id}:${variant.id}`;
                                  const current = mapping.get(mappingKey);
                                  if (current) {
                                    const placeholders = current.imagePlaceholders.map(p =>
                                      p.name === placeholder.name
                                        ? { ...p, fitMethod }
                                        : p
                                    );
                                    const newMapping = new Map(mapping);
                                    newMapping.set(mappingKey, {
                                      templateVariantId: variant.id,
                                      imagePlaceholders: placeholders,
                                    });
                                    setMapping(newMapping);
                                    onMappingChange(newMapping);
                                  }
                                }}
                                className="w-full px-2 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                              >
                                <option value="meet">Meet</option>
                                <option value="slice">Slice</option>
                              </select>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

