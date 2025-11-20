import { useState, useEffect, useCallback, useRef } from 'react';
import TemplatePicker from '../components/TemplatePicker';
import FileBrowser from '../components/FileBrowser';
import ImageVariantSelection from '../components/ImageVariantSelection';
import MetadataPanel from '../components/MetadataPanel';
import Stepper from '../components/Stepper';
import RunSheet from '../components/RunSheet';
import UnifiedQueue from '../components/UnifiedQueue';
import type { TemplateInfo, UploadedFile, CreateFromTemplateBody, ProductCreationResult, PlaceholderAssignment, VariantAssignment } from '../lib/types';
import { uploadLocal, createFromTemplate } from '../lib/api';
import { toHeadlineCase } from '../lib/utils';
import { saveCloudCredentials, getCloudCredentials } from '../lib/storage';

const STEPS = [
  { id: 1, name: 'Template', description: 'Select template' },
  { id: 2, name: 'Images', description: 'Upload artwork' },
  { id: 3, name: 'Variants', description: 'Select variants' },
  { id: 4, name: 'Metadata', description: 'Set details' },
  { id: 5, name: 'Review', description: 'Review & upload' },
  { id: 6, name: 'Queue', description: 'Upload queue' },
];

export default function Home() {
  const [currentStep, setCurrentStep] = useState(1);
  const [template, setTemplate] = useState<TemplateInfo | null>(null);
  const [images, setImages] = useState<UploadedFile[]>([]);
  const [selectedVariants, setSelectedVariants] = useState<Map<string, string[]>>(new Map());
  const [metadata, setMetadata] = useState<Partial<CreateFromTemplateBody>>({});
  const [uploading, setUploading] = useState(false);
  const [selectedCloudFilesCount, setSelectedCloudFilesCount] = useState(0);
  const [addCloudFilesHandler, setAddCloudFilesHandler] = useState<(() => Promise<void>) | null>(null);
  const [results, setResults] = useState<ProductCreationResult[]>([]);
  const [uploadProgress, setUploadProgress] = useState<{
    current: number;
    total: number;
    currentImageName: string | null;
  } | null>(null);
  
  // Track if URL params have been processed to prevent resetting during active workflow
  const urlParamsProcessedRef = useRef(false);
  const skipRestoreRef = useRef(false); // Track if we should skip restoring state (e.g., after Start New)

  // Track if we've already restored state to prevent multiple restorations
  const hasRestoredRef = useRef(false);

  // Restore state from sessionStorage on mount
  useEffect(() => {
    // Only restore once on initial mount, and skip if explicitly requested
    if (skipRestoreRef.current || hasRestoredRef.current) {
      skipRestoreRef.current = false;
      return;
    }
    
    hasRestoredRef.current = true;
    
    // Use a function to check current state at execution time, not closure time
    setCurrentStep(current => {
      try {
        // First check if there's queue progress - if so, go to step 6
        const savedQueue = sessionStorage.getItem('podmate_queue');
        if (savedQueue) {
          try {
            const parsedQueue = JSON.parse(savedQueue);
            if (Array.isArray(parsedQueue) && parsedQueue.length > 0) {
              // If queue has items (especially items that are not all complete), we should be on step 6
              const hasInProgressItems = parsedQueue.some((item: any) => 
                item.status === 'submitted' || 
                item.status === 'uploading' || 
                (item.productId && item.status !== 'complete' && item.status !== 'error')
              );
              // If there are any in-progress items OR if all are complete (showing success state), go to step 6
              if (hasInProgressItems || parsedQueue.length > 0) {
                console.log('Restoring to step 6 due to queue progress');
                return 6;
              }
            }
          } catch (err) {
            console.error('Failed to parse saved queue:', err);
          }
        }
        
        // Otherwise, restore the saved step if we're on step 1
        const savedStep = sessionStorage.getItem('podmate_currentStep');
        if (savedStep && current === 1) {
          // Only restore step if we're still on step 1 (initial state)
          const stepNum = parseInt(savedStep, 10);
          if (stepNum >= 1 && stepNum <= STEPS.length) {
            return stepNum;
          }
        }
      } catch (err) {
        console.error('Failed to restore currentStep:', err);
      }
      return current;
    });
    
    setTemplate(current => {
      try {
        const savedTemplate = sessionStorage.getItem('podmate_template');
        if (savedTemplate && !current) {
          return JSON.parse(savedTemplate);
        }
      } catch (err) {
        console.error('Failed to restore template:', err);
      }
      return current;
    });
    
    setImages(current => {
      try {
        const savedImages = sessionStorage.getItem('podmate_images');
        if (savedImages && current.length === 0) {
          const parsedImages = JSON.parse(savedImages);
          // Don't restore File objects as they can't be serialized
          return parsedImages.map((img: any) => ({
            ...img,
            file: undefined, // File objects can't be restored
          }));
        }
      } catch (err) {
        console.error('Failed to restore images:', err);
      }
      return current;
    });
    
    setSelectedVariants(current => {
      try {
        const savedVariants = sessionStorage.getItem('podmate_selectedVariants');
        if (savedVariants && current.size === 0) {
          const parsedVariants = JSON.parse(savedVariants);
          return new Map(parsedVariants);
        }
      } catch (err) {
        console.error('Failed to restore selectedVariants:', err);
      }
      return current;
    });
    
    setMetadata(current => {
      try {
        const savedMetadata = sessionStorage.getItem('podmate_metadata');
        if (savedMetadata && Object.keys(current).length === 0) {
          return JSON.parse(savedMetadata);
        }
      } catch (err) {
        console.error('Failed to restore metadata:', err);
      }
      return current;
    });
  }, []); // Only run on mount

  // Auto-select all variants for all images when template is available
  useEffect(() => {
    if (template && template.variants.length > 0 && images.length > 0) {
      setSelectedVariants(prev => {
        const newMap = new Map(prev);
        let hasChanges = false;
        
        // Ensure all images have all variants selected
        images.forEach(img => {
          const current = newMap.get(img.fileId) || [];
          const allVariantIds = template.variants.map(v => v.id);
          
          // Check if this image is missing any variants
          const missingVariants = allVariantIds.filter(id => !current.includes(id));
          
          if (missingVariants.length > 0) {
            // Add missing variants
            newMap.set(img.fileId, [...current, ...missingVariants]);
            hasChanges = true;
          } else if (current.length === 0) {
            // If image has no variants selected, select all
            newMap.set(img.fileId, allVariantIds);
            hasChanges = true;
          }
        });
        
        return hasChanges ? newMap : prev;
      });
    }
  }, [template, images]); // Run when template or images change

  // Persist state to sessionStorage whenever it changes
  useEffect(() => {
    try {
      sessionStorage.setItem('podmate_currentStep', currentStep.toString());
    } catch (err) {
      console.error('Failed to save currentStep:', err);
    }
  }, [currentStep]);

  useEffect(() => {
    try {
      if (template) {
        sessionStorage.setItem('podmate_template', JSON.stringify(template));
      } else {
        sessionStorage.removeItem('podmate_template');
      }
    } catch (err) {
      console.error('Failed to save template:', err);
    }
  }, [template]);

  useEffect(() => {
    try {
      if (images.length > 0) {
        // Don't save File objects as they can't be serialized
        // Store only essential fields to minimize storage
        const imagesToSave = images.map(img => ({
          fileId: img.fileId,
          publicUrl: img.publicUrl,
          thumbnailUrl: img.thumbnailUrl,
          originalName: img.originalName,
          sourceType: img.sourceType,
          // Skip file object
        }));
        
        const imagesData = JSON.stringify(imagesToSave);
        
        // Check if data is too large
        if (imagesData.length > 4 * 1024 * 1024) { // 4MB warning threshold
          console.warn('Images data is large, may exceed sessionStorage limits:', imagesData.length, 'bytes');
        }
        
        sessionStorage.setItem('podmate_images', imagesData);
      } else {
        sessionStorage.removeItem('podmate_images');
      }
    } catch (err) {
      // Handle quota exceeded error
      if (err instanceof DOMException && err.name === 'QuotaExceededError') {
        console.error('SessionStorage quota exceeded. Images not saved. Consider using fewer images or cloud storage.');
        // Try to save minimal version (just fileIds)
        try {
          const minimalImages = images.map(img => ({
            fileId: img.fileId,
            originalName: img.originalName,
            sourceType: img.sourceType,
          }));
          sessionStorage.setItem('podmate_images', JSON.stringify(minimalImages));
          console.warn('Saved minimal image data (without URLs). URLs will need to be refreshed.');
        } catch (minimalErr) {
          console.error('Failed to save even minimal image data:', minimalErr);
        }
      } else {
        console.error('Failed to save images:', err);
      }
    }
  }, [images]);

  useEffect(() => {
    try {
      if (selectedVariants.size > 0) {
        sessionStorage.setItem('podmate_selectedVariants', JSON.stringify(Array.from(selectedVariants.entries())));
      } else {
        sessionStorage.removeItem('podmate_selectedVariants');
      }
    } catch (err) {
      console.error('Failed to save selectedVariants:', err);
    }
  }, [selectedVariants]);

  useEffect(() => {
    try {
      if (Object.keys(metadata).length > 0) {
        sessionStorage.setItem('podmate_metadata', JSON.stringify(metadata));
      } else {
        sessionStorage.removeItem('podmate_metadata');
      }
    } catch (err) {
      console.error('Failed to save metadata:', err);
    }
  }, [metadata]);

  // Handle OAuth callbacks from Dropbox and Google Drive, and URL parameters for navigation
  useEffect(() => {
    // Only process URL params once on initial mount
    if (urlParamsProcessedRef.current) {
      return;
    }
    urlParamsProcessedRef.current = true;
    
    const params = new URLSearchParams(window.location.search);
    const credentials = getCloudCredentials();
    let updatedCredentials = { ...credentials };
    let urlCleaned = false;
    
    // Check for step parameter (for navigation from Settings)
    // Only use URL step if we're starting fresh (no template/images loaded yet)
    // This prevents URL params from resetting an active workflow
    const stepParam = params.get('step');
    if (stepParam) {
      const stepNum = parseInt(stepParam, 10);
      if (stepNum >= 1 && stepNum <= STEPS.length) {
        // Only set step from URL if we don't have template/images (fresh start)
        // This prevents resetting when user is already in a workflow
        if (!template && images.length === 0) {
          setCurrentStep(stepNum);
        }
        urlCleaned = true;
      }
    }
    
    // Check for Dropbox OAuth success
    if (params.get('dropbox_auth_success') === 'true') {
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      const expiresIn = params.get('expires_in');
      
      if (accessToken) {
        const expiryTime = expiresIn 
          ? Date.now() + (parseInt(expiresIn) * 1000)
          : Date.now() + (4 * 60 * 60 * 1000); // Default 4 hours
        
        updatedCredentials = {
          ...updatedCredentials,
          dropboxAccessToken: accessToken,
          dropboxRefreshToken: refreshToken || undefined,
          dropboxTokenExpiry: expiryTime,
        };
        // Navigate to Step 2 (Upload artwork) after successful Dropbox connection
        // Only if we're on step 1 (don't reset if user is further along)
        if (currentStep === 1) {
          setCurrentStep(2);
        }
        urlCleaned = true;
      }
    }
    
    // Check for Google Drive OAuth success
    if (params.get('googledrive_auth_success') === 'true') {
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      const expiresIn = params.get('expires_in');
      
      if (accessToken) {
        const expiryTime = expiresIn 
          ? Date.now() + (parseInt(expiresIn) * 1000)
          : Date.now() + (1 * 60 * 60 * 1000); // Default 1 hour for Google
        
        updatedCredentials = {
          ...updatedCredentials,
          googleDriveAccessToken: accessToken,
          googleDriveRefreshToken: refreshToken || undefined,
          googleDriveTokenExpiry: expiryTime,
        };
        // Navigate to Step 2 (Upload artwork) after successful Google Drive connection
        // Only if we're on step 1 (don't reset if user is further along)
        if (currentStep === 1) {
          setCurrentStep(2);
        }
        urlCleaned = true;
      }
    }
    
    // Save credentials if any OAuth succeeded
    if (urlCleaned) {
      saveCloudCredentials(updatedCredentials);
    }
    
    // Check for OAuth errors
    const dropboxError = params.get('dropbox_auth_error');
    const googleError = params.get('googledrive_auth_error');
    
    if (dropboxError) {
      console.error('Dropbox OAuth error:', dropboxError);
      urlCleaned = true;
    }
    if (googleError) {
      console.error('Google Drive OAuth error:', googleError);
      urlCleaned = true;
    }
    
    // Clean URL if any OAuth callback or step navigation was processed
    if (urlCleaned) {
      // Remove step/tab params but keep other params if they exist
      const newParams = new URLSearchParams(window.location.search);
      newParams.delete('step');
      newParams.delete('tab');
      const newSearch = newParams.toString();
      const newUrl = newSearch 
        ? `${window.location.pathname}?${newSearch}`
        : window.location.pathname;
      window.history.replaceState({}, '', newUrl);
    }
  }, []);

  const handleTemplatesLoaded = (loadedTemplates: TemplateInfo[], autoAdvance: boolean = true) => {
    // Simplified: Only use the first template
    if (loadedTemplates.length > 0) {
      setTemplate(loadedTemplates[0]);
      // Initialize all variants as selected for all images
      const newMap = new Map<string, string[]>();
      images.forEach(img => {
        newMap.set(img.fileId, loadedTemplates[0].variants.map(v => v.id));
      });
      setSelectedVariants(newMap);
      // Auto-advance only if explicitly requested AND we're on step 1 (don't reset if already further along)
      if (autoAdvance && currentStep === 1) {
        setCurrentStep(2);
      }
    }
  };

  const handleFilesAdded = async (files: File[]) => {
    setUploading(true);
    try {
      const uploaded: UploadedFile[] = [];
      const duplicates: string[] = [];
      
      for (const file of files) {
        // Check if this file already exists (by name and source type)
        const isDuplicate = images.some(
          img => img.originalName === file.name && img.sourceType === 'local'
        );
        
        if (isDuplicate) {
          duplicates.push(file.name);
          continue;
        }
        
        try {
          const result = await uploadLocal(file);
          uploaded.push({
            ...result,
            originalName: file.name,
            file,
            sourceType: 'local',
          });
        } catch (err) {
          console.error(`Failed to upload ${file.name}:`, err);
        }
      }
      
      // Duplicates are silently skipped
      
      if (uploaded.length > 0) {
        const newImages = [...images, ...uploaded];
        setImages(newImages);
        
        // Auto-select all variants for new images
        if (template) {
          const newMap = new Map(selectedVariants);
          uploaded.forEach(img => {
            newMap.set(img.fileId, template.variants.map(v => v.id));
          });
          setSelectedVariants(newMap);
        }
        
        // Move to next step if we have images and template
        if (template && currentStep === 2) {
          setCurrentStep(3);
        }
      }
    } finally {
      setUploading(false);
    }
  };

  const handleCloudUrlsAdded = (urls: Array<{ url: string; name: string; sourceType: 'dropbox' | 'googledrive' }>) => {
    const uploaded: UploadedFile[] = [];
    const duplicates: string[] = [];
    
    urls.forEach((item, index) => {
      // Check if this file already exists (by name and source type)
      const isDuplicate = images.some(
        img => img.originalName === item.name && img.sourceType === item.sourceType
      );
      
      if (isDuplicate) {
        duplicates.push(item.name);
        return;
      }
      
      // Generate a unique fileId for cloud URLs
      const fileId = `cloud-${item.sourceType}-${Date.now()}-${index}`;
      uploaded.push({
        fileId,
        publicUrl: item.url, // Use the cloud URL directly
        originalName: item.name,
        sourceType: item.sourceType,
        // No file object needed for cloud URLs
      });
    });

    // Duplicates are silently skipped

    if (uploaded.length > 0) {
      const newImages = [...images, ...uploaded];
      setImages(newImages);

      // Auto-select all variants for new images
      if (template) {
        const newMap = new Map(selectedVariants);
        uploaded.forEach(img => {
          newMap.set(img.fileId, template.variants.map(v => v.id));
        });
        setSelectedVariants(newMap);
      }

      // Move to next step if we have images and template
      if (template && currentStep === 2) {
        setCurrentStep(3);
      }
    }
  };

  const handleVariantToggle = (imageId: string, variantId: string) => {
    const newMap = new Map(selectedVariants);
    const current = newMap.get(imageId) || [];
    
    if (current.includes(variantId)) {
      newMap.set(imageId, current.filter(id => id !== variantId));
    } else {
      newMap.set(imageId, [...current, variantId]);
    }
    
    setSelectedVariants(newMap);
  };

  const handleRemoveImage = (imageId: string) => {
    // Remove image from images array
    setImages(prevImages => prevImages.filter(img => img.fileId !== imageId));
    
    // Remove image's variant selections
    const newMap = new Map(selectedVariants);
    newMap.delete(imageId);
    setSelectedVariants(newMap);
  };

  const handleSelectedFilesChange = useCallback((count: number, handler: () => Promise<void>) => {
    setSelectedCloudFilesCount(count);
    setAddCloudFilesHandler(() => handler);
  }, []);

  const handleMetadataChange = (newMetadata: Partial<CreateFromTemplateBody>) => {
    setMetadata(newMetadata);
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

  const handleNext = () => {
    if (currentStep === 1) {
      // Step 1: Template - validate template is loaded before advancing
      if (template) {
        setCurrentStep(2);
      }
      return;
    }
    
    if (currentStep === 2) {
      // Step 2: Images - move to variants if images exist
      if (images.length > 0 && template) {
        setCurrentStep(3);
      }
      return;
    }
    
    if (currentStep === 3) {
      // Step 3: Variants - validate and move to metadata
      const invalidImages = images.filter(img => {
        const variants = selectedVariants.get(img.fileId) || [];
        return variants.length === 0;
      });
      
      if (invalidImages.length > 0) {
        alert(`Please select at least one variant for each image. Images without variants: ${invalidImages.map(i => i.originalName || i.fileId).join(', ')}`);
        return;
      }
      
      setCurrentStep(4);
      return;
    }
    
    if (currentStep === 4) {
      // Step 4: Metadata - validate and move to review
      if (!metadata.description) {
        alert('Description is required');
        return;
      }

      setCurrentStep(5);
      return;
    }

    if (currentStep === 5) {
      // Step 5: Review - navigate to Queue
      setCurrentStep(6);
      return;
    }
  };

  const handlePrevious = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
      // Reset results and progress if going back from review
      if (currentStep === 5) {
        setResults([]);
        setUploadProgress(null);
      }
    }
  };

  const handleStartNew = () => {
    // Save current results to history before resetting
    if (results.length > 0) {
      const historyKey = `podmate_upload_history_${Date.now()}`;
      const historyEntry = {
        timestamp: new Date().toISOString(),
        template: template?.name || 'Unknown',
        imageCount: images.length,
        results: results,
      };
      try {
        localStorage.setItem(historyKey, JSON.stringify(historyEntry));
        const existingHistory = JSON.parse(localStorage.getItem('podmate_upload_history') || '[]');
        existingHistory.push(historyEntry);
        // Keep only last 50 uploads in history
        const trimmedHistory = existingHistory.slice(-50);
        localStorage.setItem('podmate_upload_history', JSON.stringify(trimmedHistory));
      } catch (err) {
        console.error('Failed to save upload history:', err);
      }
    }

    // Clear sessionStorage before resetting
    try {
      sessionStorage.removeItem('podmate_currentStep');
      sessionStorage.removeItem('podmate_template');
      sessionStorage.removeItem('podmate_images');
      sessionStorage.removeItem('podmate_selectedVariants');
      sessionStorage.removeItem('podmate_metadata');
    } catch (err) {
      console.error('Failed to clear sessionStorage:', err);
    }

    // Set flag to skip restoring state
    skipRestoreRef.current = true;

    // Reset all state
    setCurrentStep(1);
    setTemplate(null);
    setImages([]);
    setSelectedVariants(new Map());
    setMetadata({});
    setResults([]);
    setUploading(false);
    setUploadProgress(null);
  };

  const handleStepClick = (stepId: number) => {
    // Allow clicking on completed steps to navigate back
    if (stepId < currentStep || stepId === currentStep) {
      setCurrentStep(stepId);
    }
  };

  const renderStepContent = () => {
    switch (currentStep) {
          case 1:
            return (
              <div className="bg-white dark:bg-gray-800 shadow rounded-lg flex flex-col h-full">
                <div className="p-6 flex-1 overflow-auto min-h-0">
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Step 1: Select Template</h2>
                  <TemplatePicker onTemplatesLoaded={handleTemplatesLoaded} />
                </div>
                <div className="border-t border-gray-200 dark:border-gray-700 flex-shrink-0"></div>
                <div className="p-6 flex justify-between items-center flex-shrink-0">
                  {currentStep === 1 ? (
                    <div></div>
                  ) : (
                    <button
                      type="button"
                      onClick={handlePrevious}
                      className="text-gray-900 bg-white border border-gray-300 hover:bg-gray-100 focus:ring-4 focus:outline-none focus:ring-gray-200 font-medium rounded-lg text-sm px-5 py-2.5 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-600 dark:hover:bg-gray-700 dark:hover:text-white dark:focus:ring-gray-700"
                    >
                      ← Previous
                    </button>
                  )}
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    Step {currentStep} of {STEPS.length}
                  </div>
                  <button
                    type="button"
                    onClick={handleNext}
                    disabled={!template}
                    className="text-white bg-gray-900 dark:bg-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-100 focus:ring-4 focus:outline-none focus:ring-gray-300 dark:focus:ring-gray-700 font-medium rounded-lg text-sm px-5 py-2.5 text-center disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Next →
                  </button>
                </div>
              </div>
            );

          case 2:
            return (
              <div className="bg-white dark:bg-gray-800 shadow rounded-lg flex flex-col" style={{ height: 'calc(100vh - 420px)' }}>
                <div className="p-6 flex flex-col flex-1 min-h-0">
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Step 2: Upload Images</h2>
                  {template && (
                    <div className="mb-4 p-3 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-md flex-shrink-0">
                      <p className="text-sm text-indigo-900 dark:text-indigo-300">
                        <span className="font-medium">Template:</span> {template.name}
                      </p>
                    </div>
                  )}
                  <div className="flex-1 min-h-0 overflow-hidden">
                    <FileBrowser 
                      onFilesAdded={handleFilesAdded} 
                      onCloudUrlsAdded={handleCloudUrlsAdded}
                      initialTab={(() => {
                        try {
                          const params = new URLSearchParams(window.location.search);
                          const tabParam = params.get('tab');
                          if (tabParam === 'dropbox' || tabParam === 'googledrive' || tabParam === 'local') {
                            return tabParam;
                          }
                          return undefined;
                        } catch {
                          return undefined;
                        }
                      })()}
                      onSelectedFilesChange={handleSelectedFilesChange}
                    />
                  </div>
                  {images.length > 0 && (
                    <div className="mt-4 space-y-2 flex-shrink-0">
                      {images.some(img => !img.sourceType || img.sourceType === 'local') && (
                        <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-md">
                          <p className="text-sm text-yellow-900 dark:text-yellow-300">
                            <strong>⚠️ Keep app running:</strong> Some images are uploaded locally. Keep your computer and tunnel running until Gelato finishes downloading images (check server logs for "✅ GELATO FETCH DETECTED").
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="border-t border-gray-200 dark:border-gray-700"></div>
                <div className="p-6 flex justify-between items-center">
                  <button
                    type="button"
                    onClick={handlePrevious}
                    disabled={false}
                    className="text-gray-900 bg-white border border-gray-300 hover:bg-gray-100 focus:ring-4 focus:outline-none focus:ring-gray-200 font-medium rounded-lg text-sm px-5 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-gray-800 dark:text-gray-400 dark:border-gray-600 dark:hover:bg-gray-700 dark:hover:text-white dark:focus:ring-gray-700"
                  >
                    ← Previous
                  </button>
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    Step {currentStep} of {STEPS.length}
                  </div>
                  {currentStep === 2 && selectedCloudFilesCount > 0 && addCloudFilesHandler ? (
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          setUploading(true);
                          if (addCloudFilesHandler) {
                            await addCloudFilesHandler();
                            // Auto-advance to next step if we have images and template after adding
                            if (template && images.length > 0) {
                              setCurrentStep(3);
                            }
                          }
                        } catch (error) {
                          console.error('Error adding cloud files:', error);
                          alert(`Failed to add files: ${error instanceof Error ? error.message : 'Unknown error'}`);
                        } finally {
                          setUploading(false);
                        }
                      }}
                      disabled={uploading}
                      className="text-white bg-gray-900 dark:bg-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-100 focus:ring-4 focus:outline-none focus:ring-gray-300 dark:focus:ring-gray-700 font-medium rounded-lg text-sm px-5 py-2.5 text-center disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                      {uploading && (
                        <svg className="animate-spin h-4 w-4 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                      )}
                      {uploading ? `Adding ${selectedCloudFilesCount} file${selectedCloudFilesCount !== 1 ? 's' : ''}...` : `Add ${selectedCloudFilesCount} File${selectedCloudFilesCount !== 1 ? 's' : ''} →`}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleNext}
                      disabled={images.length === 0}
                      className="text-white bg-gray-900 dark:bg-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-100 focus:ring-4 focus:outline-none focus:ring-gray-300 dark:focus:ring-gray-700 font-medium rounded-lg text-sm px-5 py-2.5 text-center disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Next →
                    </button>
                  )}
                </div>
              </div>
            );

          case 3:
            return (
              <div className="bg-white dark:bg-gray-800 shadow rounded-lg flex flex-col" style={{ height: 'calc(100vh - 420px)' }}>
                <div className="p-6 flex-shrink-0">
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Step 3: Select Variants</h2>
                  {images.length === 0 ? (
                    <p className="text-gray-500">Please upload images first in Step 2.</p>
                  ) : (
                    <div className="mb-4 p-3 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-md">
                      <p className="text-sm text-indigo-900 dark:text-indigo-300">
                        <span className="font-medium">Uploading {images.length} image{images.length !== 1 ? 's' : ''} in total</span>
                      </p>
                    </div>
                  )}
                </div>
                <div className="flex-1 overflow-hidden flex flex-col min-h-0">
                  {images.length > 0 && (
                    <div className="flex-1 overflow-auto px-6 pb-6">
                      <ImageVariantSelection
                        template={template!}
                        images={images}
                        selectedVariants={selectedVariants}
                        onVariantToggle={handleVariantToggle}
                        onRemoveImage={handleRemoveImage}
                      />
                    </div>
                  )}
                </div>
                <div className="border-t border-gray-200 dark:border-gray-700 flex-shrink-0"></div>
                <div className="p-6 flex justify-between items-center flex-shrink-0">
                  <button
                    type="button"
                    onClick={handlePrevious}
                    disabled={false}
                    className="text-gray-900 bg-white border border-gray-300 hover:bg-gray-100 focus:ring-4 focus:outline-none focus:ring-gray-200 font-medium rounded-lg text-sm px-5 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-gray-800 dark:text-gray-400 dark:border-gray-600 dark:hover:bg-gray-700 dark:hover:text-white dark:focus:ring-gray-700"
                  >
                    ← Previous
                  </button>
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    Step {currentStep} of {STEPS.length}
                  </div>
                  <button
                    type="button"
                    onClick={handleNext}
                    disabled={images.length === 0 || (() => {
                      // Check if all images have at least one variant selected
                      const invalidImages = images.filter(img => {
                        const variants = selectedVariants.get(img.fileId) || [];
                        return variants.length === 0;
                      });
                      return invalidImages.length > 0;
                    })()}
                    className="text-white bg-gray-900 dark:bg-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-100 focus:ring-4 focus:outline-none focus:ring-gray-300 dark:focus:ring-gray-700 font-medium rounded-lg text-sm px-5 py-2.5 text-center disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Next →
                  </button>
                </div>
              </div>
            );

          case 4:
            return (
              <div className="bg-white dark:bg-gray-800 shadow rounded-lg">
                <div className="p-6">
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Step 4: Set Metadata</h2>
                  <MetadataPanel
                    initialTitle={metadata.title}
                    initialDescription={metadata.description}
                    onChange={handleMetadataChange}
                  />
                </div>
                <div className="border-t border-gray-200 dark:border-gray-700"></div>
                <div className="p-6 flex justify-between items-center">
                  <button
                    type="button"
                    onClick={handlePrevious}
                    disabled={false}
                    className="text-gray-900 bg-white border border-gray-300 hover:bg-gray-100 focus:ring-4 focus:outline-none focus:ring-gray-200 font-medium rounded-lg text-sm px-5 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-gray-800 dark:text-gray-400 dark:border-gray-600 dark:hover:bg-gray-700 dark:hover:text-white dark:focus:ring-gray-700"
                  >
                    ← Previous
                  </button>
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    Step {currentStep} of {STEPS.length}
                  </div>
                  <button
                    type="button"
                    onClick={handleNext}
                    disabled={!metadata.description}
                    className="text-white bg-gray-900 dark:bg-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-100 focus:ring-4 focus:outline-none focus:ring-gray-300 dark:focus:ring-gray-700 font-medium rounded-lg text-sm px-5 py-2.5 text-center disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Review →
                  </button>
                </div>
              </div>
            );

          case 5:
            return (
              <div className="bg-white dark:bg-gray-800 shadow rounded-lg flex flex-col" style={{ height: 'calc(100vh - 420px)' }}>
                <div className="p-6 flex-shrink-0">
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-6">Step 5: Review & Upload to Gelato</h2>
                  
                  {/* Upload Progress - shown while uploading (based on Flowbite progress bar) */}
                  {uploadProgress && (
                    <div className="mb-6">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-base font-medium text-gray-900 dark:text-white">
                          Uploading to Gelato
                        </span>
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                          {uploadProgress.current} of {uploadProgress.total}
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2.5 dark:bg-gray-700">
                        <div 
                          className="bg-blue-600 h-2.5 rounded-full dark:bg-blue-500 transition-all duration-300" 
                          style={{ width: `${(uploadProgress.current / uploadProgress.total) * 100}%` }}
                        ></div>
                      </div>
                      {uploadProgress.currentImageName && (
                        <div className="text-xs text-gray-600 dark:text-gray-400 mt-2">
                          Processing: <span className="font-medium text-gray-900 dark:text-white">{uploadProgress.currentImageName}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Summary Info Panel */}
                  <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                    <div className="flex items-start">
                      <svg className="flex-shrink-0 w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                      </svg>
                      <div className="ml-3 flex-1">
                        <h3 className="text-sm font-semibold text-blue-800 dark:text-blue-300 mb-3">Upload Summary</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                          <div>
                            <span className="font-medium text-blue-900 dark:text-blue-200">Template:</span>
                            <span className="ml-2 text-blue-800 dark:text-blue-300">{template?.name}</span>
                          </div>
                          <div>
                            <span className="font-medium text-blue-900 dark:text-blue-200">Images:</span>
                            <span className="ml-2 text-blue-800 dark:text-blue-300">{images.length}</span>
                          </div>
                          <div>
                            <span className="font-medium text-blue-900 dark:text-blue-200">Title Prefix:</span>
                            <span className="ml-2 text-blue-800 dark:text-blue-300">
                              {metadata.title ? `"${metadata.title}" (will be combined with image filename)` : 'None (using image filename only)'}
                            </span>
                          </div>
                          <div>
                            <span className="font-medium text-blue-900 dark:text-blue-200">Description:</span>
                            <span className="ml-2 text-blue-800 dark:text-blue-300">{metadata.description || 'Not set'}</span>
                          </div>
                          <div className="md:col-span-2">
                            <span className="font-medium text-blue-900 dark:text-blue-200">Products to Create:</span>
                            <span className="ml-2 text-blue-800 dark:text-blue-300">{images.length} (one per image)</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex-1 overflow-hidden flex flex-col min-h-0">
                  <div className="flex-1 overflow-auto px-6 pb-6">
                    {/* Show preview table only when there are no results yet */}
                    {images.length > 0 && results.length === 0 && (
                      <div className="mb-6">
                        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Products Preview</h3>
                        <div className="overflow-x-auto overflow-y-auto">
                          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                            <thead className="bg-gray-50 dark:bg-gray-700">
                              <tr>
                                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                                  Image
                                </th>
                                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                                  Product Title
                                </th>
                                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                                  Actions
                                </th>
                              </tr>
                            </thead>
                            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                              {images.map((image) => {
                                // Generate product title the same way as in createProducts
                                const rawImageName = (image.originalName || image.fileId).replace(/\.[^/.]+$/, '');
                                const imageName = toHeadlineCase(rawImageName);
                                const productTitle = metadata.title 
                                  ? `${metadata.title} - ${imageName}`
                                  : imageName;

                                return (
                                  <tr 
                                    key={image.fileId} 
                                    className="hover:bg-gray-50 dark:hover:bg-gray-700"
                                  >
                                    <td className="px-4 py-3 whitespace-nowrap">
                                      <div className="flex items-center space-x-3">
                                        <div className="flex-shrink-0">
                                          <img
                                            src={image.thumbnailUrl || image.publicUrl}
                                            alt={image.originalName || image.fileId}
                                            className="h-12 w-12 object-cover rounded-md border border-gray-300 dark:border-gray-600"
                                          />
                                        </div>
                                        <div className="min-w-0">
                                          <span className="text-sm font-medium text-gray-900 dark:text-white truncate">
                                            {image.originalName || image.fileId}
                                          </span>
                                        </div>
                                      </div>
                                    </td>
                                    <td className="px-4 py-3 whitespace-nowrap">
                                      <span className="text-sm text-gray-900 dark:text-white">
                                        {productTitle}
                                      </span>
                                    </td>
                                    <td className="px-4 py-3 whitespace-nowrap">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          if (confirm(`Remove "${image.originalName || image.fileId}" from the upload?`)) {
                                            handleRemoveImage(image.fileId);
                                          }
                                        }}
                                        className="text-red-700 bg-white border border-red-300 hover:bg-red-50 focus:ring-4 focus:outline-none focus:ring-red-200 font-medium rounded-lg text-sm px-3 py-1.5 dark:bg-gray-800 dark:text-red-400 dark:border-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-300 dark:focus:ring-red-800"
                                        title="Remove image"
                                      >
                                        Remove
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {results.length > 0 && (
                      <RunSheet 
                        results={results} 
                        images={images} 
                        onRetry={handleRetry}
                        onStatusUpdate={(index, updatedResult) => {
                          const newResults = [...results];
                          newResults[index] = updatedResult;
                          setResults(newResults);
                        }}
                        showExport={true}
                        templateId={template?.id}
                      />
                    )}
                  </div>
                </div>

                <div className="border-t border-gray-200 dark:border-gray-700 flex-shrink-0"></div>
                <div className="p-6 flex justify-between items-center flex-shrink-0">
                  <button
                    type="button"
                    onClick={handlePrevious}
                    disabled={
                      (results.length > 0 && !results.some(r => r.status === 'pending'))
                    }
                    className="text-gray-900 bg-white border border-gray-300 hover:bg-gray-100 focus:ring-4 focus:outline-none focus:ring-gray-200 font-medium rounded-lg text-sm px-5 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-gray-800 dark:text-gray-400 dark:border-gray-600 dark:hover:bg-gray-700 dark:hover:text-white dark:focus:ring-gray-700"
                  >
                    ← Previous
                  </button>
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    Step {currentStep} of {STEPS.length}
                  </div>
                  {/* Start Queue button */}
                  <button
                    type="button"
                    onClick={handleNext}
                    disabled={images.length === 0 || !metadata.description}
                    className="text-white bg-gray-900 dark:bg-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-100 focus:ring-4 focus:outline-none focus:ring-gray-300 dark:focus:ring-gray-700 font-medium rounded-lg text-sm px-5 py-2.5 text-center disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Start Queue →
                  </button>
                </div>
              </div>
            );

          case 6:
            return (
              template && (
                <UnifiedQueue
                  template={template}
                  images={images}
                  selectedVariants={selectedVariants}
                  metadata={metadata}
                  onComplete={() => {
                    setUploadProgress(null);
                  }}
                  onPrevious={handlePrevious}
                  onStartOver={handleStartNew}
                  autoStart={true}
                />
              )
            );

      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col lg:flex-row gap-6 max-w-[1600px] mx-auto items-start lg:items-stretch">
      {/* Side Navigation with Stepper */}
      <aside className="w-full lg:w-80 flex-shrink-0">
        <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-6 sticky top-8">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-6">Progress</h2>
          <Stepper
            steps={STEPS}
            currentStep={currentStep}
            onStepClick={handleStepClick}
            isCurrentStepComplete={currentStep === 5 && results.length > 0 && !results.some(r => r.status === 'pending') && !uploadProgress}
          />
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 min-w-0 flex flex-col">
        {/* Step Content */}
        {renderStepContent()}
      </main>
    </div>
  );
}

