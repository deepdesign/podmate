import { useState, useEffect } from 'react';
import { getTemplate } from '../lib/api';
import type { TemplateInfo, TemplateVariant } from '../lib/types';
import { 
  saveTemplate, 
  getSavedTemplates, 
  deleteTemplate,
  setLastUsedTemplateId,
  getLastUsedTemplateId,
  type SavedTemplate,
} from '../lib/storage';

type TemplatePickerProps = {
  onTemplatesLoaded: (templates: TemplateInfo[], autoAdvance?: boolean) => void;
};

export default function TemplatePicker({ onTemplatesLoaded }: TemplatePickerProps) {
  const [templateIds, setTemplateIds] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedTemplates, setLoadedTemplates] = useState<TemplateInfo[]>([]);
  const [savedTemplates, setSavedTemplates] = useState<SavedTemplate[]>([]);
  const [selectedSavedTemplateId, setSelectedSavedTemplateId] = useState<string>('');

  useEffect(() => {
    setSavedTemplates(getSavedTemplates());
  }, []);

  const parseTemplateIds = (input: string): string[] => {
    return input
      .split(/[\n,\s]+/)
      .map(id => id.trim())
      .filter(id => id.length > 0);
  };

  const handleSaveTemplate = (template: TemplateInfo) => {
    saveTemplate({
      id: template.id,
      name: template.name || `Template ${template.id}`,
      savedAt: new Date().toISOString(),
    });
    setSavedTemplates(getSavedTemplates());
  };

  const handleLoadSavedTemplate = async (templateId: string): Promise<TemplateInfo | null> => {
    setLoading(true);
    setError(null);
    try {
      const data = await getTemplate(templateId) as any;
      const variants: TemplateVariant[] = [];
      
          // Variant structure per official API docs:
          // - id (string) - Variant id
          // - title (string) - Variant title (not 'name')
          // - imagePlaceholders[] with name, printArea, height, width
          if (data.variants && Array.isArray(data.variants)) {
            for (const variant of data.variants) {
              const placeholders = (variant.imagePlaceholders || []).map((p: any) => ({
                name: p.name || '',
                size: p.height && p.width ? {
                  width: p.width,
                  height: p.height,
                  unit: 'mm', // API docs specify mm
                } : undefined,
              }));

              variants.push({
                id: variant.id || '',
                name: variant.title || variant.id, // Use 'title' per API docs
                placeholders,
              });
            }
          }

      // Extract template name - using official API field names per documentation
      // Official docs: https://dashboard.gelato.com/docs/ecommerce/templates/get/
      // Response includes: templateName (string) - Template name
      // Also available: title (string) - Product title
      const templateName = 
        data.templateName ||            // Official field per API docs
        data.title ||                   // Product title (fallback)
        `Template ${templateId}`;        // Final fallback

      const template: TemplateInfo = {
        id: templateId,
        name: templateName,
        variants,
      };

      // Auto-save with proper name from Gelato (update name if it changed)
      saveTemplate({
        id: template.id,
        name: template.name || `Template ${template.id}`,
        savedAt: new Date().toISOString(),
      });
      setSavedTemplates(getSavedTemplates());
      
      // Save as last used template
      setLastUsedTemplateId(templateId);
      
      return template;
    } catch (err) {
      setError(`Failed to load template ${templateId}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      return null;
    } finally {
      setLoading(false);
    }
  };

  // Auto-load last used template on mount (after handleLoadSavedTemplate is defined)
  useEffect(() => {
    const lastTemplateId = getLastUsedTemplateId();
    if (!lastTemplateId) return;
    
    // Check if template is already loaded in sessionStorage (restored by parent)
    try {
      const savedTemplateFromSession = sessionStorage.getItem('podmate_template');
      if (savedTemplateFromSession) {
        const parsed = JSON.parse(savedTemplateFromSession);
        if (parsed.id === lastTemplateId) {
          // Template already loaded, skip API call
          setLoadedTemplates([parsed]);
          onTemplatesLoaded([parsed], false); // Don't auto-advance on initial load
          setSelectedSavedTemplateId('');
          return;
        }
      }
    } catch (err) {
      // If parsing fails, continue with normal load
    }
    
    // Try to find it in saved templates first
    const savedTemplate = getSavedTemplates().find(t => t.id === lastTemplateId);
    if (savedTemplate) {
      // Auto-load the last used template
      handleLoadSavedTemplate(lastTemplateId).then((template) => {
        if (template) {
          setLoadedTemplates([template]);
          onTemplatesLoaded([template], false); // Don't auto-advance on initial load
          setSelectedSavedTemplateId('');
        }
      }).catch(() => {
        // If loading fails, silently continue
      });
    } else {
      // Template not in saved templates, but set it in the input field
      setTemplateIds(lastTemplateId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadTemplates = async () => {
    const ids = parseTemplateIds(templateIds);
    if (ids.length === 0) {
      setError('Please enter at least one template ID');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const templates: TemplateInfo[] = [];

      for (const id of ids) {
        try {
          const data = await getTemplate(id) as any;
          
          // Extract template structure from Gelato response
          // TODO: Map exact fields from official Gelato Get Template response schema
          // This structure should match the official API documentation exactly
          const variants: TemplateVariant[] = [];
          
          // Variant structure per official API docs:
          // - id (string) - Variant id
          // - title (string) - Variant title (not 'name')
          // - imagePlaceholders[] with name, printArea, height, width
          if (data.variants && Array.isArray(data.variants)) {
            for (const variant of data.variants) {
              const placeholders = (variant.imagePlaceholders || []).map((p: any) => ({
                name: p.name || '',
                size: p.height && p.width ? {
                  width: p.width,
                  height: p.height,
                  unit: 'mm', // API docs specify mm
                } : undefined,
              }));

              variants.push({
                id: variant.id || '',
                name: variant.title || variant.id, // Use 'title' per API docs
                placeholders,
              });
            }
          }

          // Extract template name - using official API field names per documentation
          // Official docs: https://dashboard.gelato.com/docs/ecommerce/templates/get/
          // Response includes: templateName (string) - Template name
          // Also available: title (string) - Product title
          const templateName = 
            data.templateName ||            // Official field per API docs
            data.title ||                   // Product title (fallback)
            `Template ${id}`;              // Final fallback

          const template: TemplateInfo = {
            id,
            name: templateName,
            variants,
          };

          // Auto-save template with name from Gelato
          handleSaveTemplate(template);
          
          // Save as last used template (use first template if multiple)
          if (ids.length === 1 || templates.length === 0) {
            setLastUsedTemplateId(template.id);
          }
          
          templates.push(template);
        } catch (err) {
          console.error(`Failed to load template ${id}:`, err);
          setError(`Failed to load template ${id}: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
      }

      setLoadedTemplates(templates);
      // Simplified workflow: only pass first template
      // Don't auto-advance - let user click Next manually after seeing success message
      onTemplatesLoaded(templates.slice(0, 1), false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load templates');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
        {savedTemplates.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Saved Templates ({savedTemplates.length}):</h3>
            <div className="flex gap-2">
              <select
                id="saved-template-select"
                value={selectedSavedTemplateId}
                onChange={(e) => setSelectedSavedTemplateId(e.target.value)}
                className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block flex-1 p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500"
              >
                <option value="">Select a saved template...</option>
                {savedTemplates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name} ({template.id})
                  </option>
                ))}
              </select>
              {selectedSavedTemplateId && (
                <>
                  <button
                    type="button"
                    onClick={async () => {
                      const templateId = selectedSavedTemplateId;
                      const loadedTemplate = await handleLoadSavedTemplate(templateId);
                      if (loadedTemplate) {
                        // Simplified workflow: only pass the first template (same as loadTemplates)
                        setLoadedTemplates([loadedTemplate]);
                        // Don't auto-advance when loading from dropdown - let user click Next
                        onTemplatesLoaded([loadedTemplate], false);
                        setSelectedSavedTemplateId(''); // Clear selection after loading
                        setError(null); // Clear any previous errors
                      }
                    }}
                    disabled={loading}
                    className="text-gray-900 bg-white border border-gray-300 hover:bg-gray-100 focus:ring-4 focus:outline-none focus:ring-gray-200 font-medium rounded-lg text-sm px-4 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-gray-800 dark:text-gray-400 dark:border-gray-600 dark:hover:bg-gray-700 dark:hover:text-white dark:focus:ring-gray-700"
                  >
                    {loading ? 'Loading...' : 'Load'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const templateId = selectedSavedTemplateId;
                      const template = savedTemplates.find(t => t.id === templateId);
                      if (template && confirm(`Delete saved template "${template.name}"?`)) {
                        deleteTemplate(templateId);
                        setSavedTemplates(getSavedTemplates());
                        setSelectedSavedTemplateId(''); // Clear selection after deleting
                      }
                    }}
                    className="text-red-700 bg-white border border-red-300 hover:bg-red-50 focus:ring-4 focus:outline-none focus:ring-red-200 font-medium rounded-lg text-sm px-4 py-2.5 dark:bg-gray-800 dark:text-red-400 dark:border-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-300 dark:focus:ring-red-800"
                  >
                    Delete
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        <div>
          <label htmlFor="template-ids" className="block text-sm font-medium text-gray-700 mb-2">
            Template IDs (one per line or comma-separated)
          </label>
          <textarea
            id="template-ids"
            value={templateIds}
            onChange={(e) => setTemplateIds(e.target.value)}
            className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500"
            rows={4}
            placeholder="Paste template IDs here, one per line or comma-separated"
          />
          <div className="flex justify-end mt-2">
            <button
              type="button"
              onClick={loadTemplates}
              disabled={loading}
              className="text-gray-900 bg-white border border-gray-300 hover:bg-gray-100 focus:ring-4 focus:outline-none focus:ring-gray-200 font-medium rounded-lg text-sm px-5 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-gray-800 dark:text-gray-400 dark:border-gray-600 dark:hover:bg-gray-700 dark:hover:text-white dark:focus:ring-gray-700"
            >
              {loading ? 'Loading...' : 'Import Templates'}
            </button>
          </div>
        </div>

        {error && (
          <div className="p-4 mb-4 text-sm text-red-800 rounded-lg bg-red-50 dark:bg-gray-800 dark:text-red-400" role="alert">
            {error}
          </div>
        )}

        {loadedTemplates.length > 0 && (
          <div className="mt-4 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
            <div className="flex items-center space-x-2 mb-2">
              <svg className="w-5 h-5 text-green-600 dark:text-green-400" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <h3 className="text-sm font-semibold text-green-900 dark:text-green-300">✅ Template Loaded Successfully</h3>
            </div>
            {loadedTemplates.map((template) => (
              <div key={template.id} className="text-sm text-green-800 dark:text-green-400">
                <div className="font-medium">{template.name}</div>
                <div className="text-xs mt-1 opacity-75">
                  ID: {template.id} • {template.variants.length} variant(s)
                </div>
              </div>
            ))}
            <p className="text-xs text-green-700 dark:text-green-300 mt-2">
              Click "Next →" to continue to the next step.
            </p>
          </div>
        )}
    </div>
  );
}

