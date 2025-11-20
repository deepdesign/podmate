import { useState, useEffect, useCallback, useRef } from 'react';
import { regenerateFileUrl, getTunnelUrl, createFromTemplate } from '../lib/api';
import type { TemplateInfo, UploadedFile, CreateFromTemplateBody, ProductCreationResult, VariantAssignment, PlaceholderAssignment } from '../lib/types';
import { toHeadlineCase } from '../lib/utils';

type QueueItem = {
  image: UploadedFile;
  status: 'pending' | 'refreshing' | 'processing' | 'success' | 'error' | 'skipped';
  productId?: string;
  error?: string;
  productTitle?: string;
  index: number;
};

type QueueProps = {
  template: TemplateInfo;
  images: UploadedFile[];
  selectedVariants: Map<string, string[]>;
  metadata: Partial<CreateFromTemplateBody>;
  onComplete: (results: ProductCreationResult[]) => void;
};

export default function Queue({ template, images, selectedVariants, metadata, onComplete }: QueueProps) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [tunnelUrl, setTunnelUrl] = useState<string>('');
  const [tunnelStatus, setTunnelStatus] = useState<'unknown' | 'valid' | 'invalid'>('unknown');
  const resultsRef = useRef<ProductCreationResult[]>([]);
  const processingRef = useRef(false);

  // Initialize queue from images
  useEffect(() => {
    const items: QueueItem[] = images.map((image, index) => ({
      image,
      status: 'pending',
      index,
    }));
    setQueue(items);
    resultsRef.current = [];
  }, [images]);

  // Auto-start processing when queue is ready
  useEffect(() => {
    if (queue.length > 0 && !processingRef.current && !isPaused) {
      const firstPending = queue.find(q => q.status === 'pending');
      if (firstPending) {
        // Small delay to ensure state is set and tunnel URL is fetched
        const timeoutId = setTimeout(() => {
          if (!processingRef.current && !isPaused) {
            processItem(firstPending.index);
          }
        }, 200);
        
        return () => clearTimeout(timeoutId);
      }
    }
  }, [queue, isPaused]);

  // Get tunnel URL on mount and periodically
  useEffect(() => {
    const fetchTunnelUrl = async () => {
      try {
        const response = await getTunnelUrl();
        setTunnelUrl(response.publicBaseUrl);
        // Check if tunnel URL is valid
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
    const interval = setInterval(fetchTunnelUrl, 30000); // Check every 30 seconds

    return () => clearInterval(interval);
  }, []);

  // Check if URL needs regeneration
  const needsUrlRefresh = useCallback((image: UploadedFile): boolean => {
    // Cloud URLs don't need refresh
    if (image.sourceType === 'dropbox' || image.sourceType === 'googledrive') {
      return false;
    }

    // Check if publicUrl uses a different base URL than current tunnel
    if (!image.publicUrl) {
      return true; // No URL, needs refresh
    }
    
    if (!tunnelUrl) {
      // If we don't have tunnel URL yet, check if URL looks valid
      // If it starts with http/https, assume it might be OK for now
      // Otherwise, we'll need to wait for tunnel URL to be fetched
      return !image.publicUrl.startsWith('http');
    }

    try {
      const url = new URL(image.publicUrl);
      const currentBase = new URL(tunnelUrl);
      
      // If hosts differ, URL needs refresh
      if (url.host !== currentBase.host) {
        return true;
      }

      // Check if token might be expired (simple heuristic - if URL is older than 1.5 hours)
      // We regenerate if close to expiry to be safe
      const expMatch = image.publicUrl.match(/[?&]e=(\d+)/);
      if (expMatch) {
        const expiry = parseInt(expMatch[1], 10);
        const now = Math.floor(Date.now() / 1000);
        const timeUntilExpiry = expiry - now;
        // Regenerate if less than 30 minutes remaining
        if (timeUntilExpiry < 30 * 60) {
          return true;
        }
      }

      return false;
    } catch {
      return true; // Invalid URL, needs refresh
    }
  }, [tunnelUrl]);

  // Refresh URL for an image
  const refreshImageUrl = useCallback(async (image: UploadedFile): Promise<UploadedFile> => {
    if (!needsUrlRefresh(image)) {
      return image; // No refresh needed
    }

    try {
      const result = await regenerateFileUrl(image.fileId);
      return {
        ...image,
        publicUrl: result.publicUrl,
        thumbnailUrl: result.thumbnailUrl || image.thumbnailUrl,
      };
    } catch (err) {
      console.error(`Failed to refresh URL for ${image.fileId}:`, err);
      throw err;
    }
  }, [needsUrlRefresh]);

  // Process a single queue item
  const processItem = useCallback(async (itemIndex: number) => {
    if (processingRef.current || isPaused) {
      return;
    }

    processingRef.current = true;
    setCurrentIndex(itemIndex);

    // Get current item from state
    setQueue(prev => {
      const item = prev.find(q => q.index === itemIndex);
      if (!item || item.status !== 'pending') {
        processingRef.current = false;
        setCurrentIndex(null);
        return prev;
      }

      // Process the item
      (async () => {
        try {
          // Step 1: Refresh URL if needed
          let updatedImage = item.image;
          if (needsUrlRefresh(item.image)) {
            setQueue(current => current.map(q => 
              q.index === itemIndex ? { ...q, status: 'refreshing' } : q
            ));

            try {
              updatedImage = await refreshImageUrl(item.image);
              // Update the image in the queue
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
              resultsRef.current.push({
                templateId: template.id,
                status: 'error',
                error: `Failed to refresh URL: ${err instanceof Error ? err.message : 'Unknown error'}`,
              });
              processingRef.current = false;
              setCurrentIndex(null);
              // Try next item
              setQueue(current => {
                const next = current.find(q => q.status === 'pending');
                if (next && !isPaused) {
                  setTimeout(() => processItem(next.index), 500);
                } else if (!current.some(q => q.status === 'pending' || q.status === 'processing' || q.status === 'refreshing')) {
                  onComplete(resultsRef.current);
                }
                return current;
              });
              return;
            }
          }

          // Step 2: Prepare payload
          setQueue(current => current.map(q => 
            q.index === itemIndex ? { ...q, status: 'processing' } : q
          ));

          const imageVariantIds = selectedVariants.get(updatedImage.fileId) || [];
          if (imageVariantIds.length === 0) {
            setQueue(current => current.map(q => 
              q.index === itemIndex ? { 
                ...q, 
                status: 'error', 
                error: 'No variants selected for this image' 
              } : q
            ));
            resultsRef.current.push({
              templateId: template.id,
              status: 'error',
              error: `No variants selected for image: ${updatedImage.originalName || updatedImage.fileId}`,
            });
            processingRef.current = false;
            setCurrentIndex(null);
            // Try next item
            setQueue(current => {
              const next = current.find(q => q.status === 'pending');
              if (next && !isPaused) {
                setTimeout(() => processItem(next.index), 500);
              } else if (!current.some(q => q.status === 'pending' || q.status === 'processing' || q.status === 'refreshing')) {
                onComplete(resultsRef.current);
              }
              return current;
            });
            return;
          }

          // Build variant assignments
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

          // Generate product title
          const rawImageName = (updatedImage.originalName || updatedImage.fileId).replace(/\.[^/.]+$/, '');
          const imageName = toHeadlineCase(rawImageName);
          const productTitle = metadata.title 
            ? `${metadata.title} - ${imageName}`
            : imageName;

          const payload: CreateFromTemplateBody = {
            templateId: template.id,
            title: productTitle,
            description: metadata.description || 'Product description',
            tags: metadata.tags,
            isVisibleInTheOnlineStore: metadata.isVisibleInTheOnlineStore,
            salesChannels: metadata.salesChannels,
            variants: variantAssignments,
          };

          // Step 3: Create product
          try {
            const response = await createFromTemplate(payload) as any;
            
            setQueue(current => current.map(q => 
              q.index === itemIndex ? { 
                ...q, 
                status: 'success',
                productId: response.id || '',
                productTitle,
              } : q
            ));

            resultsRef.current.push({
              templateId: template.id,
              status: 'success',
              productId: response.id || '',
              previewUrl: response.previewUrl || '',
              adminUrl: response.adminUrl || response.externalId || '',
              payloadSent: payload,
              responseReceived: response,
              imageUrlSent: updatedImage.publicUrl,
              createdAt: Date.now(),
            });
          } catch (err) {
            setQueue(current => current.map(q => 
              q.index === itemIndex ? { 
                ...q, 
                status: 'error',
                error: err instanceof Error ? err.message : 'Unknown error',
              } : q
            ));

            resultsRef.current.push({
              templateId: template.id,
              status: 'error',
              error: err instanceof Error ? err.message : 'Unknown error',
              errorDetails: err,
              payloadSent: payload,
              imageUrlSent: updatedImage.publicUrl,
            });
          }
        } finally {
          processingRef.current = false;
          setCurrentIndex(null);

          // Process next item if queue is not paused
          setQueue(current => {
            if (!isPaused) {
              const next = current.find(q => q.status === 'pending');
              if (next) {
                // Small delay before next item
                setTimeout(() => processItem(next.index), 500);
              } else if (!current.some(q => q.status === 'pending' || q.status === 'processing' || q.status === 'refreshing')) {
                // All items processed
                onComplete(resultsRef.current);
              }
            }
            return current;
          });
        }
      })();

      return prev;
    });
  }, [template, selectedVariants, metadata, needsUrlRefresh, refreshImageUrl, isPaused, onComplete]);


  // Pause/resume
  const togglePause = () => {
    const newPausedState = !isPaused;
    setIsPaused(newPausedState);
    if (!newPausedState) {
      // If resuming, continue processing
      setQueue(current => {
        const nextItem = current.find(q => q.status === 'pending');
        if (nextItem && !processingRef.current) {
          processItem(nextItem.index);
        }
        return current;
      });
    }
  };

  // Retry failed item
  const retryItem = (index: number) => {
    setQueue(current => {
      const item = current.find(q => q.index === index);
      if (item && (item.status === 'error' || item.status === 'skipped')) {
        const updated = current.map(q => 
          q.index === index ? { ...q, status: 'pending' as const, error: undefined } : q
        );
        // Remove from results if it was there (find by index)
        const queueIndex = current.findIndex(q => q.index === index);
        if (queueIndex >= 0 && queueIndex < resultsRef.current.length) {
          resultsRef.current = resultsRef.current.filter((_, i) => i !== queueIndex);
        }
        
        if (!processingRef.current && !isPaused) {
          const retryItem = updated.find(q => q.index === index);
          if (retryItem) {
            processItem(retryItem.index);
          }
        }
        return updated;
      }
      return current;
    });
  };

  const completed = queue.filter(q => q.status === 'success').length;
  const failed = queue.filter(q => q.status === 'error').length;
  const pending = queue.filter(q => q.status === 'pending').length;
  const processing = queue.filter(q => q.status === 'processing' || q.status === 'refreshing').length;

  return (
    <div className="bg-white dark:bg-gray-800 shadow rounded-lg max-w-7xl mx-auto">
      <div className="p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-6">Upload Queue</h2>

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
              <h3 className="font-semibold text-sm mb-1">
                Tunnel Status: {tunnelStatus === 'valid' ? '✅ Connected' : tunnelStatus === 'invalid' ? '❌ Disconnected' : '⚠️ Unknown'}
              </h3>
              <p className="text-xs opacity-75">
                {tunnelUrl || 'No tunnel URL configured'}
              </p>
            </div>
            <button
              onClick={async () => {
                try {
                  const response = await getTunnelUrl();
                  setTunnelUrl(response.publicBaseUrl);
                  setTunnelStatus(response.publicBaseUrl ? 'valid' : 'invalid');
                } catch (err) {
                  setTunnelStatus('invalid');
                }
              }}
              className="text-xs px-3 py-1 rounded bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              Refresh
            </button>
          </div>
        </div>

        {/* Queue Controls */}
        {queue.length > 0 && (pending > 0 || processing > 0 || completed > 0 || failed > 0) && (
          <div className="mb-6 flex gap-3">
            <button
              onClick={togglePause}
              disabled={pending === 0 && processing === 0}
              className="text-gray-900 bg-white border border-gray-300 hover:bg-gray-100 focus:ring-4 focus:outline-none focus:ring-gray-200 font-medium rounded-lg text-sm px-5 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-gray-800 dark:text-gray-400 dark:border-gray-600 dark:hover:bg-gray-700"
            >
              {isPaused ? 'Resume' : 'Pause'}
            </button>
          </div>
        )}

        {/* Progress Summary */}
        <div className="mb-6">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-medium text-gray-900 dark:text-white">
              Progress: {completed} completed, {failed} failed, {pending} pending
            </span>
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {queue.length > 0 ? Math.round(((completed + failed) / queue.length) * 100) : 0}%
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2.5 dark:bg-gray-700">
            <div 
              className="bg-blue-600 h-2.5 rounded-full dark:bg-blue-500 transition-all duration-300" 
              style={{ width: `${queue.length > 0 ? ((completed + failed) / queue.length) * 100 : 0}%` }}
            ></div>
          </div>
        </div>

        {/* Queue Items */}
        <div className="space-y-2 max-h-[600px] overflow-y-auto">
          {queue.map((item) => {
            const isCurrent = currentIndex === item.index;
            const statusColors = {
              pending: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
              refreshing: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
              processing: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
              success: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
              error: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
              skipped: 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
            };

            return (
              <div
                key={item.index}
                className={`p-4 rounded-lg border-2 ${
                  isCurrent ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20' : 'border-gray-200 dark:border-gray-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 flex-1">
                    {item.image.thumbnailUrl && (
                      <img
                        src={item.image.thumbnailUrl}
                        alt={item.image.originalName || item.image.fileId}
                        className="h-12 w-12 object-cover rounded border border-gray-300 dark:border-gray-600"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900 dark:text-white truncate">
                        {item.image.originalName || item.image.fileId}
                      </div>
                      {item.productTitle && (
                        <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                          {item.productTitle}
                        </div>
                      )}
                      {item.error && (
                        <div className="text-xs text-red-600 dark:text-red-400 mt-1">
                          {item.error}
                        </div>
                      )}
                      {item.productId && (
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          Product ID: {item.productId}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-1 rounded-full font-semibold ${statusColors[item.status]}`}>
                      {item.status}
                    </span>
                    {item.status === 'error' && (
                      <button
                        onClick={() => retryItem(item.index)}
                        className="text-xs px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700"
                      >
                        Retry
                      </button>
                    )}
                    {isCurrent && (
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-purple-600"></div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Info Message */}
        {queue.length === 0 && (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            No items in queue
          </div>
        )}
      </div>
    </div>
  );
}

