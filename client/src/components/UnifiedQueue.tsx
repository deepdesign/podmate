import { useState, useEffect, useCallback, useRef } from 'react';
import { regenerateFileUrl, getTunnelUrl, createFromTemplate, getProductStatus } from '../lib/api';
import type { TemplateInfo, UploadedFile, CreateFromTemplateBody, VariantAssignment, PlaceholderAssignment } from '../lib/types';
import { toHeadlineCase } from '../lib/utils';
import { generateCSV, downloadCSV } from '../lib/validators';

type QueueItem = {
  image: UploadedFile;
  status: 'submitted' | 'uploading' | 'complete' | 'error';
  productId?: string;
  productTitle?: string;
  error?: string;
  index: number;
  // Detailed status from Gelato
  gelatoStatus?: {
    status: string;
    isReadyToPublish?: boolean;
    variants?: Array<{
      id?: string;
      title?: string;
      status?: string;
      [key: string]: unknown;
    }>;
    productImages?: Array<{
      id?: string;
      url?: string;
      [key: string]: unknown;
    }>;
    previewUrl?: string;
    adminUrl?: string;
    title?: string;
    description?: string;
    templateId?: string;
    createdAt?: string;
    updatedAt?: string;
    [key: string]: unknown;
  };
  // Timestamps
  submittedAt?: number;
  completedAt?: number;
  // Troubleshooting data
  payloadSent?: CreateFromTemplateBody;
  responseReceived?: unknown;
  imageUrlSent?: string;
  errorDetails?: unknown;
};

type UnifiedQueueProps = {
  template: TemplateInfo;
  images: UploadedFile[];
  selectedVariants: Map<string, string[]>;
  metadata: Partial<CreateFromTemplateBody>;
  onComplete?: () => void;
  onPrevious?: () => void;
  onStartOver?: () => void;
  autoStart?: boolean;
};

export default function UnifiedQueue({ template, images, selectedVariants, metadata, onComplete, onPrevious, onStartOver, autoStart = false }: UnifiedQueueProps) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [tunnelUrl, setTunnelUrl] = useState<string>('');
  const [tunnelStatus, setTunnelStatus] = useState<'unknown' | 'valid' | 'invalid'>('unknown');
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [checkingStatus, setCheckingStatus] = useState<Set<number>>(new Set());
  const processingRef = useRef(false);
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Track if queue has been initialized to prevent duplicate initialization
  const queueInitializedRef = useRef<Set<string>>(new Set());
  // Track which fileIds are currently being processed or have been completed to prevent duplicates
  const processedFileIdsRef = useRef<Set<string>>(new Set());
  const hasRestoredQueueRef = useRef(false);

  // Restore queue state from sessionStorage on mount
  useEffect(() => {
    if (hasRestoredQueueRef.current || images.length === 0) return;
    
    try {
      const savedQueue = sessionStorage.getItem('podmate_queue');
      const savedHasStarted = sessionStorage.getItem('podmate_queue_hasStarted');
      const savedIsPaused = sessionStorage.getItem('podmate_queue_isPaused');
      
        if (savedQueue) {
          const parsedQueue: any[] = JSON.parse(savedQueue);
          // Only restore if the saved queue matches current images (same fileIds)
          const savedFileIds = new Set(parsedQueue.map((q: any) => q.fileId).filter(Boolean));
          const currentFileIds = new Set(images.map(img => img.fileId));
          
          const fileIdsMatch = savedFileIds.size === currentFileIds.size &&
            [...savedFileIds].every(id => currentFileIds.has(id));
          
          if (fileIdsMatch && parsedQueue.length === images.length) {
            // Reindex items to match current images order
            // Note: saved queue items only have fileId, not full image objects
            const reindexedQueue: QueueItem[] = images.map((image, index) => {
              const savedItem = parsedQueue.find((q: any) => q.fileId === image.fileId);
              if (savedItem) {
                return {
                  status: savedItem.status || 'submitted',
                  index,
                  image, // Use current image data from images prop
                  productId: savedItem.productId,
                  productTitle: savedItem.productTitle,
                  error: savedItem.error,
                  submittedAt: savedItem.submittedAt || Date.now(),
                  completedAt: savedItem.completedAt,
                  gelatoStatus: savedItem.gelatoStatus,
                };
              }
              // Fallback: create new item if not found in saved queue
              return {
                image,
                status: 'submitted' as const,
                index,
                submittedAt: Date.now(),
              };
            });
          
          setQueue(reindexedQueue);
          
          // Restore processing flags
          if (savedHasStarted === 'true') {
            setHasStarted(true);
          }
          if (savedIsPaused === 'true') {
            setIsPaused(true);
          }
          
          // Mark processed fileIds for items that are complete or have productIds
          reindexedQueue.forEach(item => {
            if (item.status === 'complete' || item.productId) {
              processedFileIdsRef.current.add(item.image.fileId);
            }
          });
          
          hasRestoredQueueRef.current = true;
          
          return; // Don't initialize from images if we restored
        }
      }
    } catch (err) {
      console.error('Failed to restore queue state:', err);
    }
    
    hasRestoredQueueRef.current = true;
  }, [images]);

  // Persist queue state to sessionStorage whenever it changes
  useEffect(() => {
    if (queue.length === 0) return;
    
    try {
      // Save minimal queue state - only store fileId reference, not full image objects
      const queueToSave = queue.map(q => ({
        status: q.status,
        index: q.index,
        productId: q.productId,
        productTitle: q.productTitle,
        error: q.error,
        fileId: q.image.fileId, // Only store fileId reference
        submittedAt: q.submittedAt,
        completedAt: q.completedAt,
        gelatoStatus: q.gelatoStatus,
        // Don't store: image (reconstruct from images prop), payloadSent, responseReceived, imageUrlSent, errorDetails
      }));
      
      const queueData = JSON.stringify(queueToSave);
      
      // Check if data is too large (sessionStorage limit is typically 5-10MB)
      if (queueData.length > 4 * 1024 * 1024) { // 4MB warning threshold
        console.warn('Queue data is large, may exceed sessionStorage limits:', queueData.length, 'bytes');
      }
      
      sessionStorage.setItem('podmate_queue', queueData);
      sessionStorage.setItem('podmate_queue_hasStarted', hasStarted.toString());
      sessionStorage.setItem('podmate_queue_isPaused', isPaused.toString());
    } catch (err) {
      // Handle quota exceeded error
      if (err instanceof DOMException && err.name === 'QuotaExceededError') {
        console.error('SessionStorage quota exceeded. Queue state not saved. Error:', err);
        // Optionally try to save a minimal version
        try {
          const minimalQueue = queue.map(q => ({
            status: q.status,
            index: q.index,
            productId: q.productId,
            fileId: q.image.fileId,
          }));
          sessionStorage.setItem('podmate_queue', JSON.stringify(minimalQueue));
        } catch (minimalErr) {
          console.error('Failed to save even minimal queue state:', minimalErr);
        }
      } else {
        console.error('Failed to save queue state:', err);
      }
    }
  }, [queue, hasStarted, isPaused]);

  // Clear queue persistence when starting over
  useEffect(() => {
    if (onStartOver) {
      // Clear queue state when component unmounts if starting over
      return () => {
        try {
          sessionStorage.removeItem('podmate_queue');
          sessionStorage.removeItem('podmate_queue_hasStarted');
          sessionStorage.removeItem('podmate_queue_isPaused');
        } catch (err) {
          console.error('Failed to clear queue state:', err);
        }
      };
    }
  }, [onStartOver]);

  // Initialize queue from images (only if not restored)
  useEffect(() => {
    if (!hasRestoredQueueRef.current) return;
    
    // Create a unique key for this images array to detect if we've already initialized
    const imagesKey = images.map(img => img.fileId).sort().join('|');
    
    // Only initialize if we haven't already initialized for this exact set of images
    if (queueInitializedRef.current.has(imagesKey)) {
      return;
    }
    
    queueInitializedRef.current.add(imagesKey);
    // Reset processed fileIds when initializing a new queue
    processedFileIdsRef.current.clear();
    
    const items: QueueItem[] = images.map((image, index) => ({
      image,
      status: 'submitted',
      index,
      submittedAt: Date.now(),
    }));
    setQueue(items);
    // If autoStart is true, automatically start the queue
    if (autoStart && items.length > 0) {
      setHasStarted(true);
      setIsPaused(false);
    } else {
      setHasStarted(false); // Reset start state when images change
    }
  }, [images, autoStart]);

  // Get tunnel URL on mount and periodically
  useEffect(() => {
    const fetchTunnelUrl = async () => {
      try {
        const response = await getTunnelUrl();
        setTunnelUrl(response.publicBaseUrl);
        if (response.publicBaseUrl && response.publicBaseUrl.startsWith('http')) {
          setTunnelStatus('valid');
        } else {
          setTunnelStatus('invalid');
        }
      } catch (err) {
        console.error('Failed to get tunnel URL:', err);
        setTunnelStatus('invalid');
      }
    };

    fetchTunnelUrl();
    const interval = setInterval(fetchTunnelUrl, 30000);
    return () => clearInterval(interval);
  }, []);

  // Check if URL needs regeneration
  const needsUrlRefresh = useCallback((image: UploadedFile): boolean => {
    if (image.sourceType === 'dropbox' || image.sourceType === 'googledrive') {
      return false;
    }
    if (!image.publicUrl) return true;
    if (!tunnelUrl) return !image.publicUrl.startsWith('http');
    
    try {
      const url = new URL(image.publicUrl);
      const currentBase = new URL(tunnelUrl);
      if (url.host !== currentBase.host) return true;
      
      const expMatch = image.publicUrl.match(/[?&]e=(\d+)/);
      if (expMatch) {
        const expiry = parseInt(expMatch[1], 10);
        const now = Math.floor(Date.now() / 1000);
        if (expiry - now < 30 * 60) return true; // Less than 30 min
      }
      return false;
    } catch {
      return true;
    }
  }, [tunnelUrl]);

  // Refresh URL for an image
  const refreshImageUrl = useCallback(async (image: UploadedFile): Promise<UploadedFile> => {
    if (!needsUrlRefresh(image)) return image;
    try {
      const result = await regenerateFileUrl(image.fileId);
      return { ...image, publicUrl: result.publicUrl, thumbnailUrl: result.thumbnailUrl || image.thumbnailUrl };
    } catch (err) {
      console.error(`Failed to refresh URL for ${image.fileId}:`, err);
      throw err;
    }
  }, [needsUrlRefresh]);

  // Track which items are currently being processed to prevent duplicates
  const processingItemsRef = useRef<Set<number>>(new Set());

  // Process a single queue item
  const processItem = useCallback(async (itemIndex: number) => {
    if (processingRef.current || isPaused) return;
    
    // Check if this item is already being processed
    if (processingItemsRef.current.has(itemIndex)) {
      console.warn(`Item ${itemIndex} is already being processed, skipping duplicate`);
      return;
    }

    processingRef.current = true;
    processingItemsRef.current.add(itemIndex);
    setCurrentIndex(itemIndex);

    setQueue(prev => {
      const queueItem = prev.find(q => q.index === itemIndex);
      if (!queueItem || queueItem.status !== 'submitted') {
        processingRef.current = false;
        processingItemsRef.current.delete(itemIndex);
        setCurrentIndex(null);
        return prev;
      }
      
      // Check if this fileId has already been processed or is being processed
      if (processedFileIdsRef.current.has(queueItem.image.fileId)) {
        console.warn(`File ${queueItem.image.fileId} (index ${itemIndex}) has already been processed, skipping duplicate`);
        processingRef.current = false;
        processingItemsRef.current.delete(itemIndex);
        setCurrentIndex(null);
        return prev;
      }
      
      // Mark fileId as being processed
      processedFileIdsRef.current.add(queueItem.image.fileId);

      (async () => {
        try {
          // Step 1: Refresh URL if needed
          let updatedImage = queueItem.image;
          if (needsUrlRefresh(queueItem.image)) {
            setQueue(current => current.map(q => 
              q.index === itemIndex ? { ...q, status: 'uploading' } : q
            ));

            try {
              updatedImage = await refreshImageUrl(queueItem.image);
              setQueue(current => current.map(q => 
                q.index === itemIndex ? { ...q, image: updatedImage } : q
              ));
            } catch (err) {
              setQueue(current => current.map(q => 
                q.index === itemIndex ? { 
                  ...q, 
                  status: 'error',
                  error: `Failed to refresh URL: ${err instanceof Error ? err.message : 'Unknown error'}` 
                } : q
              ));
              processingRef.current = false;
              processingItemsRef.current.delete(itemIndex);
              processedFileIdsRef.current.delete(queueItem.image.fileId); // Remove from processed set on error
              setCurrentIndex(null);
              processNextItem();
              return;
            }
          }

          // Step 2: Upload to Gelato
          setQueue(current => current.map(q => 
            q.index === itemIndex ? { ...q, status: 'uploading' } : q
          ));

          const imageVariantIds = selectedVariants.get(updatedImage.fileId) || [];
          if (imageVariantIds.length === 0) {
            setQueue(current => current.map(q => 
              q.index === itemIndex ? { ...q, status: 'error', error: 'No variants selected' } : q
            ));
            processingRef.current = false;
            processingItemsRef.current.delete(itemIndex);
            processedFileIdsRef.current.delete(queueItem.image.fileId); // Remove from processed set on error
            setCurrentIndex(null);
            processNextItem();
            return;
          }

          const variantAssignments: VariantAssignment[] = [];
          for (const variantId of imageVariantIds) {
            const variant = template.variants.find(v => v.id === variantId);
            if (!variant) continue;

            const placeholders: PlaceholderAssignment[] = variant.placeholders.map(placeholder => ({
              name: placeholder.name,
              fileUrl: updatedImage.publicUrl,
            }));

            variantAssignments.push({
              templateVariantId: variantId,
              imagePlaceholders: placeholders,
            });
          }

          const rawImageName = (updatedImage.originalName || updatedImage.fileId).replace(/\.[^/.]+$/, '');
          const imageName = toHeadlineCase(rawImageName);
          const productTitle = metadata.title ? `${metadata.title} - ${imageName}` : imageName;

          const payload: CreateFromTemplateBody = {
            templateId: template.id,
            title: productTitle,
            description: metadata.description || 'Product description',
            tags: metadata.tags,
            isVisibleInTheOnlineStore: metadata.isVisibleInTheOnlineStore,
            salesChannels: metadata.salesChannels,
            variants: variantAssignments,
          };

          try {
            // Double-check this fileId hasn't been processed by another instance
            if (processedFileIdsRef.current.has(updatedImage.fileId) && 
                !processingItemsRef.current.has(itemIndex)) {
              console.warn(`File ${updatedImage.fileId} was processed by another instance, skipping`);
              processingRef.current = false;
              processingItemsRef.current.delete(itemIndex);
              processedFileIdsRef.current.delete(queueItem.image.fileId);
              setCurrentIndex(null);
              processNextItem();
              return;
            }
            
            const response = await createFromTemplate(payload) as any;
            
            setQueue(current => current.map(q => 
              q.index === itemIndex ? { 
                ...q, 
                status: 'uploading', // Still uploading - Gelato is processing
                productId: response.id || '',
                productTitle,
                payloadSent: payload,
                responseReceived: response,
                imageUrlSent: updatedImage.publicUrl,
              } : q
            ));

            // Check status immediately
            if (response.id) {
              checkItemStatus(itemIndex, response.id);
            }
          } catch (err) {
            setQueue(current => current.map(q => 
              q.index === itemIndex ? { 
                ...q, 
                status: 'error',
                error: err instanceof Error ? err.message : 'Unknown error',
                errorDetails: err,
                payloadSent: payload,
                imageUrlSent: updatedImage.publicUrl,
              } : q
            ));
          }
        } finally {
          processingRef.current = false;
          processingItemsRef.current.delete(itemIndex);
          setCurrentIndex(null);
          processNextItem();
        }
      })();

      return prev;
    });
  }, [template, selectedVariants, metadata, needsUrlRefresh, refreshImageUrl, isPaused]);

  // Process next item
  const processNextItem = useCallback(() => {
    if (!isPaused && !processingRef.current) {
      setQueue(current => {
        const next = current.find(q => q.status === 'submitted');
        if (next) {
          setTimeout(() => processItem(next.index), 500);
        } else if (onComplete && !current.some(q => q.status === 'submitted' || q.status === 'uploading')) {
          onComplete();
        }
        return current;
      });
    }
  }, [isPaused, processItem, onComplete]);

  // Check status of an item from Gelato API
  const checkItemStatus = useCallback(async (itemIndex: number, productId: string, isAutoCheck = false) => {
    if (checkingStatus.has(itemIndex)) return;

    if (isAutoCheck) {
      setCheckingStatus(prev => new Set(prev).add(itemIndex));
    }

    try {
      const status = await getProductStatus(productId) as any;
      const variantsCount = Array.isArray(status.variants) ? status.variants.length : 0;
      const isReady = status.isReadyToPublish === true || status.status !== 'created';

      setQueue(current => current.map(q => {
        if (q.index !== itemIndex) return q;

        const newItem = { ...q, gelatoStatus: status };
        
        // Mark as complete if Gelato has fully processed (variants created and ready)
        if (isReady && variantsCount > 0) {
          newItem.status = 'complete';
          newItem.completedAt = Date.now();
        } else if (q.status === 'error') {
          // Keep error status
        } else {
          // Still uploading/processing
          newItem.status = 'uploading';
        }

        return newItem;
      }));
    } catch (err) {
      console.error(`Failed to check status for item ${itemIndex}:`, err);
    } finally {
      if (isAutoCheck) {
        setCheckingStatus(prev => {
          const next = new Set(prev);
          next.delete(itemIndex);
          return next;
        });
      }
    }
  }, [checkingStatus]);

  // Track if we've checked restored items
  const hasCheckedRestoredItemsRef = useRef(false);

  // Check status of restored items on mount (after checkItemStatus is defined)
  useEffect(() => {
    if (hasCheckedRestoredItemsRef.current || queue.length === 0) return;
    
    // Only check if items have productIds (indicating they were restored from a previous session)
    const itemsToCheck = queue
      .filter(item => (item.status === 'uploading' || item.productId) && item.productId && !item.completedAt)
      .map(item => ({ index: item.index, productId: item.productId! }));
    
    if (itemsToCheck.length > 0) {
      hasCheckedRestoredItemsRef.current = true;
      // Check status after a delay to allow component to fully mount
      const timeoutId = setTimeout(() => {
        itemsToCheck.forEach(({ index, productId }) => {
          checkItemStatus(index, productId, true);
        });
      }, 2000);
      
      return () => clearTimeout(timeoutId);
    }
  }, [queue, checkItemStatus]);

  // Auto-poll for uploading items
  useEffect(() => {
    const POLL_INTERVAL = 3 * 60 * 1000; // 3 minutes
    const MIN_TIME_BETWEEN_CHECKS = 2 * 60 * 1000; // 2 minutes

    const checkUploadingItems = () => {
      queue.forEach((item) => {
        if (item.status === 'uploading' && item.productId && !checkingStatus.has(item.index)) {
          const timeSinceSubmit = item.submittedAt ? Date.now() - item.submittedAt : 0;
          if (timeSinceSubmit >= MIN_TIME_BETWEEN_CHECKS) {
            checkItemStatus(item.index, item.productId, true);
          }
        }
      });
    };

    pollingIntervalRef.current = setInterval(checkUploadingItems, POLL_INTERVAL);
    
    // Initial check after 2 minutes
    const initialTimeout = setTimeout(checkUploadingItems, 2 * 60 * 1000);

    return () => {
      clearTimeout(initialTimeout);
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, [queue, checkingStatus, checkItemStatus]);

  // Auto-start processing (only after user clicks Start Queue)
  useEffect(() => {
    if (hasStarted && queue.length > 0 && !processingRef.current && !isPaused) {
      const firstSubmitted = queue.find(q => q.status === 'submitted');
      if (firstSubmitted) {
        setTimeout(() => processItem(firstSubmitted.index), 200);
      }
    }
  }, [hasStarted, queue, isPaused, processItem]);

  // Manual status check
  const handleCheckStatus = async (itemIndex: number) => {
    const item = queue.find(q => q.index === itemIndex);
    if (item?.productId) {
      await checkItemStatus(itemIndex, item.productId, false);
    }
  };

  // Retry failed item
  const retryItem = (itemIndex: number) => {
    setQueue(current => current.map(q => 
      q.index === itemIndex ? { ...q, status: 'submitted', error: undefined, errorDetails: undefined } : q
    ));
    if (!processingRef.current && !isPaused) {
      setTimeout(() => processItem(itemIndex), 100);
    }
  };

  // Export CSV
  const handleExport = () => {
    const csvData = queue.map(item => ({
      templateId: template.id,
      status: item.status,
      productId: item.productId || '',
      previewUrl: item.gelatoStatus?.previewUrl || '',
      adminUrl: item.gelatoStatus?.adminUrl || '',
      error: item.error || '',
    }));
    const csv = generateCSV(csvData);
    downloadCSV(csv);
  };

  const completed = queue.filter(q => q.status === 'complete').length;
  const uploading = queue.filter(q => q.status === 'uploading').length;
  const submitted = queue.filter(q => q.status === 'submitted').length;
  const errors = queue.filter(q => q.status === 'error').length;
  const allComplete = queue.length > 0 && completed === queue.length && errors === 0;

  return (
    <div className="bg-white dark:bg-gray-800 shadow rounded-lg max-w-7xl mx-auto">
      <div className="p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-6">Step 6: Upload Queue</h2>

        {/* Success Message */}
        {allComplete && (
          <div className="mb-6 p-6 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
            <div className="flex items-start">
              <svg className="flex-shrink-0 w-6 h-6 text-green-600 dark:text-green-400 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <div className="ml-3 flex-1">
                <h3 className="text-lg font-semibold text-green-900 dark:text-green-300 mb-2">
                  🎉 All Products Successfully Processed!
                </h3>
                <p className="text-sm text-green-800 dark:text-green-400 mb-4">
                  All {queue.length} product{queue.length !== 1 ? 's' : ''} have been uploaded to Gelato and processed successfully. 
                  Variants and thumbnails are now available in your Gelato dashboard.
                </p>
                <div className="flex gap-3 flex-wrap">
                  {onStartOver && (
                    <button
                      onClick={onStartOver}
                      className="text-white bg-gray-900 dark:bg-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-100 focus:ring-4 focus:outline-none focus:ring-gray-300 dark:focus:ring-gray-700 font-medium rounded-lg text-sm px-6 py-3"
                    >
                      Start New Upload →
                    </button>
                  )}
                  <a
                    href="https://dashboard.gelato.com/stores/list"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 font-medium text-sm px-6 py-3 transition-colors"
                  >
                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                    View in Gelato Dashboard
                  </a>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tunnel Status */}
        <div className={`mb-6 p-4 rounded-lg border ${
          tunnelStatus === 'valid' 
            ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' 
            : tunnelStatus === 'invalid'
            ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
            : 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800'
        }`}>
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">
                Tunnel Status: {tunnelStatus === 'valid' ? '✅ Connected' : tunnelStatus === 'invalid' ? '❌ Disconnected' : '⚠️ Unknown'}
              </h3>
              <p className="text-xs text-gray-600 dark:text-gray-400">{tunnelUrl || 'No tunnel URL configured'}</p>
            </div>
            <button
              onClick={async () => {
                try {
                  const response = await getTunnelUrl();
                  setTunnelUrl(response.publicBaseUrl);
                  setTunnelStatus(response.publicBaseUrl ? 'valid' : 'invalid');
                } catch {
                  setTunnelStatus('invalid');
                }
              }}
              className="text-gray-900 bg-white border border-gray-300 hover:bg-gray-100 focus:ring-4 focus:outline-none focus:ring-gray-200 font-medium rounded-lg text-sm px-4 py-2 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-600 dark:hover:bg-gray-700 dark:focus:ring-gray-700"
            >
              Refresh
            </button>
          </div>
        </div>

        {/* Controls */}
        <div className="mb-6 flex justify-between items-center">
          <div className="flex gap-3">
            {!hasStarted && !autoStart && queue.length > 0 && (
              <button
                onClick={() => {
                  setHasStarted(true);
                  setIsPaused(false);
                }}
                className="text-white bg-gray-900 dark:bg-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-100 focus:ring-4 focus:outline-none focus:ring-gray-300 dark:focus:ring-gray-700 font-medium rounded-lg text-sm px-5 py-2.5"
              >
                Start Queue →
              </button>
            )}
            {hasStarted && (submitted > 0 || uploading > 0) && (
              <button
                onClick={() => setIsPaused(!isPaused)}
                className="text-gray-900 bg-white border border-gray-300 hover:bg-gray-100 focus:ring-4 focus:outline-none focus:ring-gray-200 font-medium rounded-lg text-sm px-5 py-2.5 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-600 dark:hover:bg-gray-700 dark:focus:ring-gray-700"
              >
                {isPaused ? 'Resume' : 'Pause'}
              </button>
            )}
          </div>
          
          <div className="flex items-center gap-4">
            <div className="text-sm text-gray-600 dark:text-gray-400">
              {completed} complete • {uploading} uploading • {submitted} pending • {errors} errors
            </div>
            <button
              onClick={handleExport}
              className="text-gray-900 bg-white border border-gray-300 hover:bg-gray-100 focus:ring-4 focus:outline-none focus:ring-gray-200 font-medium rounded-lg text-sm px-4 py-2 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-600 dark:hover:bg-gray-700 dark:focus:ring-gray-700"
            >
              Export CSV
            </button>
          </div>
        </div>

        {/* Progress Bar */}
        {queue.length > 0 && (
          <div className="mb-6">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-medium text-gray-900 dark:text-white">Progress</span>
              <span className="text-sm text-gray-600 dark:text-gray-400">
                {Math.round(((completed + errors) / queue.length) * 100)}%
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2.5 dark:bg-gray-700">
              <div 
                className="bg-blue-600 h-2.5 rounded-full dark:bg-blue-500 transition-all duration-300" 
                style={{ width: `${((completed + errors) / queue.length) * 100}%` }}
              ></div>
            </div>
          </div>
        )}

        {/* Queue Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left text-gray-500 dark:text-gray-400 table-fixed">
            <colgroup>
              <col style={{ width: '45%' }} />
              <col style={{ width: '35%' }} />
              <col style={{ width: '20%' }} />
            </colgroup>
            <thead className="text-xs text-gray-700 uppercase bg-gray-50 dark:bg-gray-700 dark:text-gray-400">
              <tr>
                <th scope="col" className="px-6 py-3">Image</th>
                <th scope="col" className="px-6 py-3">Product ID</th>
                <th scope="col" className="px-6 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {queue.map((item) => {
                const isExpanded = expandedRows.has(item.index);
                const isCurrent = currentIndex === item.index;
                const statusColors = {
                  submitted: 'bg-gray-100 text-gray-800 dark:bg-gray-700',
                  uploading: 'bg-blue-100 text-blue-800 dark:bg-blue-900',
                  complete: 'bg-green-100 text-green-800 dark:bg-green-900',
                  error: 'bg-red-100 text-red-800 dark:bg-red-900',
                };

                return (
                  <>
                    <tr 
                      key={item.index}
                      className={`hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer ${
                        isCurrent ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                      }`}
                      onClick={() => {
                        const newExpanded = new Set(expandedRows);
                        if (isExpanded) {
                          newExpanded.delete(item.index);
                        } else {
                          newExpanded.add(item.index);
                        }
                        setExpandedRows(newExpanded);
                      }}
                    >
                      <td className="px-6 py-4 align-top">
                        <div className="flex items-center gap-3">
                          {/* Chevron indicator for expandability */}
                          <svg 
                            className={`w-4 h-4 text-gray-500 dark:text-gray-400 transition-transform duration-200 flex-shrink-0 ${
                              isExpanded ? 'rotate-90' : ''
                            }`}
                            fill="none" 
                            stroke="currentColor" 
                            viewBox="0 0 24 24"
                            aria-hidden="true"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                          {item.image.thumbnailUrl && (
                            <img
                              src={item.image.thumbnailUrl}
                              alt={item.image.originalName || item.image.fileId}
                              className="h-12 w-12 object-cover rounded border border-gray-300 dark:border-gray-600 flex-shrink-0"
                            />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-gray-900 dark:text-white truncate">
                              {item.image.originalName || item.image.fileId}
                            </div>
                            {item.productTitle && (
                              <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                                {item.productTitle}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 align-top">
                        <span className="font-mono text-xs text-gray-900 dark:text-white break-all">{item.productId || '-'}</span>
                      </td>
                      <td className="px-6 py-4 align-top">
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-1 rounded-full text-xs font-semibold ${statusColors[item.status]}`}>
                            {item.status}
                          </span>
                          {isCurrent && (
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 flex-shrink-0" aria-label="Processing"></div>
                          )}
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${item.index}-details`} className="bg-gray-50 dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700">
                        <td colSpan={3} className="px-6 py-4" style={{ width: '100%' }}>
                          <div className="space-y-4 text-xs">
                            {/* Actions */}
                            <div className="flex gap-2 pb-3 border-b border-gray-200 dark:border-gray-700" onClick={(e) => e.stopPropagation()}>
                              {item.productId && item.status !== 'complete' && (
                                <button
                                  onClick={() => handleCheckStatus(item.index)}
                                  disabled={checkingStatus.has(item.index)}
                                  className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 focus:ring-4 focus:ring-blue-300 dark:focus:ring-blue-800 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                                >
                                  {checkingStatus.has(item.index) ? 'Checking...' : 'Check Status'}
                                </button>
                              )}
                              {item.status === 'error' && (
                                <button
                                  onClick={() => retryItem(item.index)}
                                  className="text-xs px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700 focus:ring-4 focus:ring-green-300 dark:focus:ring-green-800 font-medium"
                                >
                                  Retry
                                </button>
                              )}
                            </div>
                            
                            {/* Status Details */}
                            {item.error && (
                              <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded mb-3">
                                <strong className="text-red-800 dark:text-red-300">❌ Error:</strong>
                                <p className="text-red-700 dark:text-red-400 mt-1">{item.error}</p>
                              </div>
                            )}
                            
                            {/* Gelato Status Diagnostics */}
                            {item.gelatoStatus && (() => {
                              const status = item.gelatoStatus;
                              const variants = Array.isArray(status.variants) ? status.variants : [];
                              const productImages = Array.isArray(status.productImages) ? status.productImages : [];
                              const variantsCount = variants.length;
                              const productImagesCount = productImages.length;
                              const isCreated = status.status === 'created';
                              const isReady = status.isReadyToPublish === true;
                              const isProcessing = isCreated && !isReady;
                              
                              // Additional useful fields
                              const productTitle = status.title || item.productTitle;
                              const templateId = status.templateId;
                              const createdAt = status.createdAt ? new Date(status.createdAt).toLocaleString() : null;
                              const updatedAt = status.updatedAt ? new Date(status.updatedAt).toLocaleString() : null;
                              
                              if (item.status === 'complete') {
                                return (
                                  <div className="space-y-3">
                                    <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded">
                                      <strong className="text-green-800 dark:text-green-300">✅ Processing Complete!</strong>
                                      <p className="text-green-700 dark:text-green-400 mt-1 text-sm">
                                        Gelato has successfully processed your images and all variants are connected.
                                        <br />
                                        • Variants created and connected: {variantsCount}
                                        <br />
                                        • Product images: {productImagesCount}
                                      </p>
                                    </div>
                                    
                                    {/* Additional Product Info */}
                                    {(productTitle || templateId || createdAt || updatedAt) && (
                                      <div className="p-3 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded text-xs">
                                        <strong className="text-gray-900 dark:text-white">Product Information:</strong>
                                        <ul className="mt-1 space-y-1 text-gray-700 dark:text-gray-300">
                                          {productTitle && <li><strong>Title:</strong> {productTitle}</li>}
                                          {templateId && <li><strong>Template ID:</strong> <code className="bg-gray-200 dark:bg-gray-800 px-1 rounded">{templateId}</code></li>}
                                          {createdAt && <li><strong>Created:</strong> {createdAt}</li>}
                                          {updatedAt && <li><strong>Last Updated:</strong> {updatedAt}</li>}
                                        </ul>
                                      </div>
                                    )}
                                    
                                    {/* Variant Details */}
                                    {variantsCount > 0 && variants.length > 0 && (
                                      <div className="p-3 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded text-xs">
                                        <strong className="text-gray-900 dark:text-white">Variants ({variantsCount}):</strong>
                                        <ul className="mt-1 space-y-1 text-gray-700 dark:text-gray-300">
                                          {variants.slice(0, 5).map((variant: any, idx: number) => (
                                            <li key={idx}>
                                              {variant.title || variant.id ? (
                                                <>
                                                  <strong>{variant.title || 'Variant'}:</strong> <code className="bg-gray-200 dark:bg-gray-800 px-1 rounded">{variant.id || 'N/A'}</code>
                                                  {variant.status && <span className="ml-2 text-gray-500">({variant.status})</span>}
                                                </>
                                              ) : (
                                                <code className="bg-gray-200 dark:bg-gray-800 px-1 rounded">Variant {idx + 1}</code>
                                              )}
                                            </li>
                                          ))}
                                          {variantsCount > 5 && <li className="text-gray-500 italic">...and {variantsCount - 5} more</li>}
                                        </ul>
                                      </div>
                                    )}
                                  </div>
                                );
                              }
                              
                              if (isProcessing && variantsCount > 0) {
                                const submittedTime = item.submittedAt ? new Date(item.submittedAt).toLocaleTimeString() : null;
                                const checkTime = new Date().toLocaleTimeString();
                                const elapsedMinutes = item.submittedAt ? Math.floor((Date.now() - item.submittedAt) / 60000) : null;
                                
                                return (
                                  <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded mb-3">
                                    <strong className="text-yellow-800 dark:text-yellow-300">⏳ Variants Created, Connecting...</strong>
                                    <p className="text-yellow-700 dark:text-yellow-400 mt-2 text-xs">
                                      Gelato has created {variantsCount} variant{variantsCount !== 1 ? 's' : ''} but they're not fully connected yet.
                                      <br />
                                      <br />
                                      <strong>What's happening:</strong>
                                      <ul className="list-disc list-inside mt-1 space-y-1">
                                        <li>Variants exist in Gelato ({variantsCount} variant{variantsCount !== 1 ? 's' : ''})</li>
                                        <li>But 0 variants are connected (as shown in Gelato dashboard)</li>
                                        <li>Gelato is still processing and connecting variants to product images</li>
                                        <li>This final step can take 10-30+ minutes for large images</li>
                                      </ul>
                                      <br />
                                      <strong>What to do:</strong>
                                      <ul className="list-disc list-inside mt-1 space-y-1">
                                        <li>Wait 10-30 minutes for variants to fully connect</li>
                                        <li>Click <strong>"Check Status"</strong> periodically to see when `isReadyToPublish` becomes `true`</li>
                                        <li>Once `isReadyToPublish: true`, all variants will be connected and ready</li>
                                      </ul>
                                      <br />
                                      {submittedTime && (
                                        <span className="text-xs opacity-75">
                                          Uploaded {submittedTime}, checked {checkTime}
                                          {elapsedMinutes !== null && ` - ${elapsedMinutes} min elapsed`}
                                        </span>
                                      )}
                                      <br />
                                      <strong className="text-blue-700 dark:text-blue-400 block mt-2">💡 You can safely close this app - processing continues on Gelato's servers!</strong>
                                    </p>
                                  </div>
                                );
                              }
                              
                              if (isProcessing && variantsCount === 0 && productImagesCount === 0) {
                                const submittedTime = item.submittedAt ? new Date(item.submittedAt).toLocaleTimeString() : null;
                                const checkTime = new Date().toLocaleTimeString();
                                const elapsedMinutes = item.submittedAt ? Math.floor((Date.now() - item.submittedAt) / 60000) : null;
                                
                                return (
                                  <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded mb-3">
                                    <strong className="text-yellow-800 dark:text-yellow-300">⏳ Processing in Early Stage:</strong>
                                    <p className="text-yellow-700 dark:text-yellow-400 mt-2 text-xs">
                                      Gelato has received your product and is downloading/processing the images.
                                      <br />
                                      <br />
                                      <strong>What's happening:</strong>
                                      <ul className="list-disc list-inside mt-1 space-y-1">
                                        <li>Gelato is fetching images from your server</li>
                                        <li>Large high-resolution files (50-100MB+) can take 30-60+ minutes to fully download and process</li>
                                        <li>Images are then processed and optimized for each variant</li>
                                        <li>Variants and thumbnails will appear once processing completes</li>
                                      </ul>
                                      <br />
                                      <strong>Timeline for large files:</strong>
                                      <ul className="list-disc list-inside mt-1 space-y-1">
                                        <li><strong>0-30 minutes:</strong> Gelato downloads and validates the image</li>
                                        <li><strong>30-60 minutes:</strong> Images are processed and optimized for each variant</li>
                                        <li><strong>60-120 minutes:</strong> Variants and thumbnails appear in Gelato dashboard</li>
                                      </ul>
                                      <br />
                                      <strong>What to do:</strong>
                                      <ul className="list-disc list-inside mt-1 space-y-1">
                                        <li>For large files, wait 30-60 minutes before checking again</li>
                                        <li>Click <strong>"Check Status"</strong> periodically to see progress</li>
                                        <li>Check server logs for <code className="bg-yellow-100 dark:bg-yellow-800 px-1 rounded">✅ GELATO FETCH DETECTED</code> - repeated fetches every minute indicate Gelato is actively working on it</li>
                                      </ul>
                                      <br />
                                      {submittedTime && (
                                        <span className="text-xs opacity-75">
                                          Uploaded {submittedTime}, checked {checkTime}
                                          {elapsedMinutes !== null && ` - ${elapsedMinutes} min elapsed`}
                                        </span>
                                      )}
                                      <br />
                                      <strong className="text-blue-700 dark:text-blue-400 block mt-2">💡 You can safely close this app - processing continues on Gelato's servers!</strong>
                                    </p>
                                  </div>
                                );
                              }
                              
                              if (isProcessing && (variantsCount > 0 || productImagesCount > 0)) {
                                const submittedTime = item.submittedAt ? new Date(item.submittedAt).toLocaleTimeString() : null;
                                const checkTime = new Date().toLocaleTimeString();
                                const elapsedMinutes = item.submittedAt ? Math.floor((Date.now() - item.submittedAt) / 60000) : null;
                                
                                return (
                                  <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded mb-3">
                                    <strong className="text-yellow-800 dark:text-yellow-300">⏳ Processing in Progress:</strong>
                                    <p className="text-yellow-700 dark:text-yellow-400 mt-2 text-xs">
                                      Gelato is currently processing your images.
                                      <br />
                                      <br />
                                      <strong>Current Status:</strong>
                                      <ul className="list-disc list-inside mt-1 space-y-1">
                                        <li>Variants: {variantsCount} {variantsCount === 0 ? '(still processing)' : '(completed)'}</li>
                                        <li>Product Images: {productImagesCount} {productImagesCount === 0 ? '(still processing)' : '(completed)'}</li>
                                      </ul>
                                      <br />
                                      Processing typically takes 5-10 minutes total. Click <strong>"Check Status"</strong> again in a few minutes to see updated progress.
                                      <br />
                                      {submittedTime && (
                                        <>
                                          <br />
                                          <span className="text-xs opacity-75">
                                            Uploaded {submittedTime}, checked {checkTime}
                                            {elapsedMinutes !== null && ` - ${elapsedMinutes} min elapsed`}
                                          </span>
                                        </>
                                      )}
                                      <br />
                                      <strong className="text-blue-700 dark:text-blue-400 block mt-2">💡 You can safely close this app - processing continues on Gelato's servers!</strong>
                                    </p>
                                  </div>
                                );
                              }
                              
                              return (
                                <div className="space-y-3">
                                  <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded">
                                    <strong className="text-blue-800 dark:text-blue-300">Status: {status.status || 'unknown'}</strong>
                                    <p className="text-blue-700 dark:text-blue-400 mt-1 text-sm">
                                      Variants: {variantsCount}, Images: {productImagesCount}, Ready: {isReady ? 'Yes' : 'No'}
                                    </p>
                                  </div>
                                  
                                  {/* Additional Product Info if available */}
                                  {(productTitle || templateId || createdAt || updatedAt) && (
                                    <div className="p-3 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded text-xs">
                                      <strong className="text-gray-900 dark:text-white">Product Information:</strong>
                                      <ul className="mt-1 space-y-1 text-gray-700 dark:text-gray-300">
                                        {productTitle && <li><strong>Title:</strong> {productTitle}</li>}
                                        {templateId && <li><strong>Template ID:</strong> <code className="bg-gray-200 dark:bg-gray-800 px-1 rounded">{templateId}</code></li>}
                                        {createdAt && <li><strong>Created:</strong> {createdAt}</li>}
                                        {updatedAt && <li><strong>Last Updated:</strong> {updatedAt}</li>}
                                      </ul>
                                    </div>
                                  )}
                                  
                                  {/* Variant Details if available */}
                                  {variantsCount > 0 && variants.length > 0 && (
                                    <div className="p-3 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded text-xs">
                                      <strong className="text-gray-900 dark:text-white">Variants ({variantsCount}):</strong>
                                      <ul className="mt-1 space-y-1 text-gray-700 dark:text-gray-300">
                                        {variants.slice(0, 3).map((variant: any, idx: number) => (
                                          <li key={idx}>
                                            {variant.title || variant.id ? (
                                              <>
                                                <strong>{variant.title || 'Variant'}:</strong> <code className="bg-gray-200 dark:bg-gray-800 px-1 rounded">{variant.id || 'N/A'}</code>
                                                {variant.status && <span className="ml-2 text-gray-500">({variant.status})</span>}
                                              </>
                                            ) : (
                                              <code className="bg-gray-200 dark:bg-gray-800 px-1 rounded">Variant {idx + 1}</code>
                                            )}
                                          </li>
                                        ))}
                                        {variantsCount > 3 && <li className="text-gray-500 italic">...and {variantsCount - 3} more</li>}
                                      </ul>
                                    </div>
                                  )}
                                </div>
                              );
                            })()}

                            {/* Image URL Preview */}
                            {item.imageUrlSent ? (
                              <div className="mt-3 pb-3 border-b border-gray-200 dark:border-gray-700">
                                <strong className="text-gray-900 dark:text-white">Image URL Sent:</strong>
                                <div className="mt-2 space-y-2">
                                  <div>
                                    <a
                                      href={item.imageUrlSent}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-300 break-all text-xs"
                                    >
                                      {item.imageUrlSent}
                                    </a>
                                    <span className="ml-2 text-gray-500 dark:text-gray-400 text-xs">(Click to test if accessible)</span>
                                  </div>
                                  <div className="mt-2 p-2 bg-gray-100 dark:bg-gray-800 rounded border border-gray-300 dark:border-gray-600">
                                    <div className="text-xs text-gray-600 dark:text-gray-400 mb-1 font-medium">
                                      Original Image Preview (verify it looks correct):
                                    </div>
                                    <div className="relative">
                                      <img
                                        src={item.imageUrlSent}
                                        alt="Original uploaded image"
                                        className="max-w-xs max-h-48 border border-gray-300 dark:border-gray-600 rounded"
                                        onError={(e) => {
                                          const target = e.target as HTMLImageElement;
                                          target.style.display = 'none';
                                          const errorDiv = document.createElement('div');
                                          errorDiv.className = 'text-red-600 dark:text-red-400 text-sm p-2 bg-red-50 dark:bg-red-900/20 rounded';
                                          errorDiv.textContent = '❌ Image failed to load - may be corrupted, expired, or URL inaccessible';
                                          target.parentElement?.appendChild(errorDiv);
                                        }}
                                      />
                                    </div>
                                  </div>
                                  <div className="text-xs text-gray-600 dark:text-gray-400 mt-2 p-2 bg-blue-50 dark:bg-blue-900/20 rounded border border-blue-200 dark:border-blue-800">
                                    <strong>💡 Diagnostic Tips:</strong>
                                    <ul className="list-disc list-inside mt-1 space-y-1">
                                      <li>If this preview looks <strong>correct</strong> but Gelato shows black areas → Image is likely still processing (wait 5-10 min, then click "Check Status")</li>
                                      <li>If this preview shows <strong>black areas</strong> → The original file may be corrupted or incomplete</li>
                                      <li>If this preview <strong>fails to load</strong> → The URL may have expired or the file was deleted</li>
                                    </ul>
                                  </div>
                                </div>
                              </div>
                            ) : null}

                            {/* Preview and Admin URLs */}
                            {item.gelatoStatus && (item.gelatoStatus.previewUrl || item.gelatoStatus.adminUrl) && (
                              <div className="mt-3 pb-3 border-b border-gray-200 dark:border-gray-700">
                                <strong className="text-gray-900 dark:text-white">Product Links:</strong>
                                <div className="mt-2 flex gap-3">
                                  {item.gelatoStatus.previewUrl && (
                                    <a
                                      href={item.gelatoStatus.previewUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-xs text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-300"
                                    >
                                      Preview
                                    </a>
                                  )}
                                  {item.gelatoStatus.adminUrl && (
                                    <a
                                      href={item.gelatoStatus.adminUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-xs text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-300"
                                    >
                                      Admin
                                    </a>
                                  )}
                                </div>
                              </div>
                            )}

                            {/* Payload and Response - Flowbite Accordion Pattern */}
                            <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 space-y-2">
                              <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Technical Details</h4>
                              
                              {item.payloadSent && (
                                <details className="group">
                                  <summary className="flex items-center justify-between w-full p-3 text-sm font-medium text-left text-gray-900 bg-gray-100 border border-gray-200 rounded-t-lg cursor-pointer hover:bg-gray-200 dark:bg-gray-800 dark:border-gray-700 dark:text-white dark:hover:bg-gray-700 transition-colors">
                                    <span>Payload Sent to Gelato</span>
                                    <svg 
                                      className="w-4 h-4 text-gray-500 dark:text-gray-400 transition-transform group-open:rotate-180 flex-shrink-0"
                                      fill="none" 
                                      stroke="currentColor" 
                                      viewBox="0 0 24 24"
                                      aria-hidden="true"
                                    >
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                    </svg>
                                  </summary>
                                  <div className="p-3 bg-gray-50 dark:bg-gray-900 border border-t-0 border-gray-200 dark:border-gray-700 rounded-b-lg">
                                    <pre className="text-xs text-gray-800 dark:text-gray-200 overflow-x-auto whitespace-pre-wrap break-words">
                                      {JSON.stringify(item.payloadSent, null, 2)}
                                    </pre>
                                  </div>
                                </details>
                              )}

                              {item.responseReceived ? (
                                <details className="group">
                                  <summary className="flex items-center justify-between w-full p-3 text-sm font-medium text-left text-gray-900 bg-gray-100 border border-gray-200 rounded-t-lg cursor-pointer hover:bg-gray-200 dark:bg-gray-800 dark:border-gray-700 dark:text-white dark:hover:bg-gray-700 transition-colors">
                                    <span>Response from Gelato</span>
                                    <svg 
                                      className="w-4 h-4 text-gray-500 dark:text-gray-400 transition-transform group-open:rotate-180 flex-shrink-0"
                                      fill="none" 
                                      stroke="currentColor" 
                                      viewBox="0 0 24 24"
                                      aria-hidden="true"
                                    >
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                    </svg>
                                  </summary>
                                  <div className="p-3 bg-gray-50 dark:bg-gray-900 border border-t-0 border-gray-200 dark:border-gray-700 rounded-b-lg">
                                    <pre className="text-xs text-gray-800 dark:text-gray-200 overflow-x-auto whitespace-pre-wrap break-words">
                                      {JSON.stringify(item.responseReceived, null, 2)}
                                    </pre>
                                  </div>
                                </details>
                              ) : null}

                              {item.gelatoStatus && (
                                <details className="group">
                                  <summary className="flex items-center justify-between w-full p-3 text-sm font-medium text-left text-gray-900 bg-gray-100 border border-gray-200 rounded-t-lg cursor-pointer hover:bg-gray-200 dark:bg-gray-800 dark:border-gray-700 dark:text-white dark:hover:bg-gray-700 transition-colors">
                                    <span>Latest Status from Gelato API</span>
                                    <svg 
                                      className="w-4 h-4 text-gray-500 dark:text-gray-400 transition-transform group-open:rotate-180 flex-shrink-0"
                                      fill="none" 
                                      stroke="currentColor" 
                                      viewBox="0 0 24 24"
                                      aria-hidden="true"
                                    >
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                    </svg>
                                  </summary>
                                  <div className="p-3 bg-gray-50 dark:bg-gray-900 border border-t-0 border-gray-200 dark:border-gray-700 rounded-b-lg">
                                    <pre className="text-xs text-gray-800 dark:text-gray-200 overflow-x-auto whitespace-pre-wrap break-words">
                                      {JSON.stringify(item.gelatoStatus, null, 2)}
                                    </pre>
                                  </div>
                                </details>
                              )}
                            </div>

                            {/* Error Details */}
                            {item.errorDetails && (
                              <div className="mt-3">
                                <strong className="text-red-600 dark:text-red-400">Error Details:</strong>
                                <pre className="mt-1 p-2 bg-red-50 dark:bg-red-900/20 rounded text-xs overflow-x-auto text-red-800 dark:text-red-300">
                                  {JSON.stringify(item.errorDetails, null, 2)}
                                </pre>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {/* Navigation - built into card */}
      <div className="border-t border-gray-200 dark:border-gray-700"></div>
      <div className="p-6 flex justify-between items-center">
        <button
          type="button"
          onClick={onPrevious}
          className="text-gray-900 bg-white border border-gray-300 hover:bg-gray-100 focus:ring-4 focus:outline-none focus:ring-gray-200 font-medium rounded-lg text-sm px-5 py-2.5 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-600 dark:hover:bg-gray-700 dark:hover:text-white dark:focus:ring-gray-700"
        >
          ← Previous
        </button>
        <div className="text-sm text-gray-500 dark:text-gray-400">
          Step 6 of 6
        </div>
        <div></div>
      </div>
    </div>
  );
}

