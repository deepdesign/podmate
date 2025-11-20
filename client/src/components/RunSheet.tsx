import { useState, useEffect, useRef } from 'react';
import type React from 'react';
import type { ProductCreationResult } from '../lib/types';
import { generateCSV, downloadCSV } from '../lib/validators';
import { getProductStatus } from '../lib/api';

type RunSheetProps = {
  results: ProductCreationResult[];
  images?: Array<{ fileId: string; originalName?: string; publicUrl?: string; sourceType?: 'local' | 'dropbox' | 'googledrive' }>;
  onRetry: (index: number) => Promise<void>;
  onStatusUpdate?: (index: number, updatedResult: ProductCreationResult) => void;
  showExport?: boolean;
  templateId?: string;
};

export default function RunSheet({ results, images, onRetry, onStatusUpdate, showExport = true, templateId }: RunSheetProps) {
  const [retryingIndex, setRetryingIndex] = useState<number | null>(null);
  const [checkingStatusIndex, setCheckingStatusIndex] = useState<number | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [expandedSections, setExpandedSections] = useState<Map<string, boolean>>(new Map());
  const [lastChecked, setLastChecked] = useState<Map<number, number>>(new Map()); // index -> timestamp
  const [autoChecking, setAutoChecking] = useState<Set<number>>(new Set()); // indices being auto-checked
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
  const toggleSection = (key: string) => {
    const newMap = new Map(expandedSections);
    newMap.set(key, !newMap.get(key));
    setExpandedSections(newMap);
  };
  
  const isSectionExpanded = (key: string) => expandedSections.get(key) ?? false;

  const handleRetry = async (index: number) => {
    setRetryingIndex(index);
    try {
      await onRetry(index);
    } finally {
      setRetryingIndex(null);
    }
  };

  const handleExport = () => {
    const csv = generateCSV(results);
    downloadCSV(csv);
  };

  const handleCheckStatus = async (index: number, isAutoCheck = false) => {
    const result = results[index];
    if (!result.productId) return;

    if (isAutoCheck) {
      setAutoChecking(prev => new Set(prev).add(index));
    } else {
      setCheckingStatusIndex(index);
    }
    
    try {
      const status = await getProductStatus(result.productId) as any;
      
      // Update the result with latest status
      const variantsCount = Array.isArray(status.variants) ? status.variants.length : 0;
      const productImagesCount = Array.isArray(status.productImages) ? status.productImages.length : 0;
      const isReady = status.isReadyToPublish === true || status.status !== 'created';
      
      // Determine new status
      let newStatus = result.status;
      const checkTime = new Date().toLocaleTimeString();
      const uploadTime = result.createdAt ? new Date(result.createdAt).toLocaleTimeString() : null;
      const elapsedMinutes = result.createdAt ? Math.floor((Date.now() - result.createdAt) / 60000) : null;
      
      let statusMessage = result.error || 'Product created successfully';
      
      // Only mark as complete if isReadyToPublish is true - this means variants are connected
      if (isReady && variantsCount > 0) {
        newStatus = 'success';
        const elapsed = elapsedMinutes !== null ? ` (${elapsedMinutes} min elapsed)` : '';
        statusMessage = `✅ Processing complete! ${variantsCount} variants connected, ${productImagesCount} images${elapsed}`;
      } else if (variantsCount > 0 || productImagesCount > 0) {
        // Has variants/images but not ready - variants are created but not connected
        newStatus = 'warning';
        const uploadInfo = uploadTime ? ` (uploaded ${uploadTime}, checked ${checkTime})` : ` (checked ${checkTime})`;
        const elapsedInfo = elapsedMinutes !== null ? ` - ${elapsedMinutes} min elapsed` : '';
        statusMessage = `⏳ Variants created but connecting...${uploadInfo}${elapsedInfo} - ${variantsCount} variants created, 0 connected`;
      } else if (status.status === 'created' && status.isReadyToPublish === false) {
        newStatus = 'warning';
        const uploadInfo = uploadTime ? ` (uploaded ${uploadTime}, checked ${checkTime})` : ` (checked ${checkTime})`;
        const elapsedInfo = elapsedMinutes !== null ? ` - ${elapsedMinutes} min elapsed` : '';
        statusMessage = `⏳ Still processing${uploadInfo}${elapsedInfo} - ${variantsCount} variants so far`;
      } else if (isReady) {
        newStatus = 'success';
        statusMessage = `✅ Ready to publish (checked ${checkTime})`;
      } else {
        // Always update timestamp even if status hasn't changed
        statusMessage = `${statusMessage.split('(')[0].trim()} (checked ${checkTime})`;
      }
      
      const updatedResult: ProductCreationResult = {
        ...result,
        responseReceived: status,
        status: newStatus,
        error: statusMessage, // Update status message
        previewUrl: status.previewUrl || result.previewUrl,
        adminUrl: status.adminUrl || status.externalId || result.adminUrl,
      };

      if (onStatusUpdate) {
        onStatusUpdate(index, updatedResult);
      }
      
      // Update last checked time
      setLastChecked(prev => {
        const newMap = new Map(prev);
        newMap.set(index, Date.now());
        return newMap;
      });
      
      // Auto-expand the row so user can see the updated response (only on manual check)
      if (!isAutoCheck) {
        const newExpanded = new Set(expandedRows);
        newExpanded.add(index);
        setExpandedRows(newExpanded);
      }
    } catch (err) {
      console.error('Failed to check status:', err);
      // Show error in status message
      const errorMessage = err instanceof Error ? err.message : 'Failed to check status';
      const updatedResult: ProductCreationResult = {
        ...result,
        error: `❌ Error checking status: ${errorMessage}`,
        status: 'error',
      };
      if (onStatusUpdate) {
        onStatusUpdate(index, updatedResult);
      }
    } finally {
      if (isAutoCheck) {
        setAutoChecking(prev => {
          const newSet = new Set(prev);
          newSet.delete(index);
          return newSet;
        });
      } else {
        setCheckingStatusIndex(null);
      }
    }
  };
  
  // Auto-poll for products that are still processing
  useEffect(() => {
    // Check every 3 minutes for products that are still processing
    const POLL_INTERVAL = 3 * 60 * 1000; // 3 minutes
    const MIN_TIME_BETWEEN_CHECKS = 2 * 60 * 1000; // Don't check if checked less than 2 minutes ago
    
    const checkProcessingProducts = () => {
      results.forEach((result, index) => {
        // Only auto-check products that:
        // 1. Have a productId
        // 2. Are still processing (warning or pending status, or status=created with no variants)
        // 3. Haven't been checked recently
        if (!result.productId) return;
        
        const response = result.responseReceived as any;
        const variantsCount = response && Array.isArray(response.variants) ? response.variants.length : 0;
        const isProcessing = result.status === 'warning' || 
                            result.status === 'pending' ||
                            (response && response.status === 'created' && response.isReadyToPublish === false && variantsCount === 0);
        
        if (isProcessing) {
          const lastCheckTime = lastChecked.get(index) || 0;
          const timeSinceLastCheck = Date.now() - lastCheckTime;
          
          // Only check if it's been at least MIN_TIME_BETWEEN_CHECKS since last check
          // and we're not already checking this one
          if (timeSinceLastCheck >= MIN_TIME_BETWEEN_CHECKS && !autoChecking.has(index) && checkingStatusIndex !== index) {
            handleCheckStatus(index, true);
          }
        }
      });
    };
    
    // Initial check after 2 minutes
    const initialTimeout = setTimeout(() => {
      checkProcessingProducts();
    }, 2 * 60 * 1000);
    
    // Then check every POLL_INTERVAL
    pollingIntervalRef.current = setInterval(checkProcessingProducts, POLL_INTERVAL);
    
    return () => {
      clearTimeout(initialTimeout);
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, lastChecked, autoChecking, checkingStatusIndex]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'success':
        return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300';
      case 'error':
        return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300';
      case 'warning':
        return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300';
      case 'pending':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
    }
  };

  // Calculate progress stats
  const total = results.length;
  const created = results.filter(r => r.productId && r.status !== 'error').length;
  const completed = results.filter(r => {
    if (!r.productId || r.status === 'error') return false;
    const response = r.responseReceived as any;
    if (!response) return false;
    const variantsCount = Array.isArray(response.variants) ? response.variants.length : 0;
    // Consider complete if:
    // 1. Status is ready (isReadyToPublish or status changed from "created")
    // 2. AND variants are populated (indicates images processed)
    const isReady = response.isReadyToPublish === true || (response.status !== 'created' && response.status !== undefined);
    const hasVariants = variantsCount > 0;
    // Complete ONLY if ready AND has variants - this ensures variants are actually connected
    // Just having product images isn't enough - we need variants to be connected
    return isReady && hasVariants;
  }).length;
  const errors = results.filter(r => r.status === 'error').length;
  const processing = created - completed - errors;
  const creationProgress = total > 0 ? (created / total) * 100 : 0;
  const processingProgress = created > 0 ? (completed / created) * 100 : 0;
  const allComplete = total > 0 && completed === total && errors === 0;

  return (
    <div>
      {showExport && (
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Results</h2>
          <button
            type="button"
            onClick={handleExport}
            className="text-gray-900 bg-white border border-gray-300 hover:bg-gray-100 focus:ring-4 focus:outline-none focus:ring-gray-200 font-medium rounded-lg text-sm px-4 py-2 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-600 dark:hover:bg-gray-700 dark:hover:text-white dark:focus:ring-gray-700"
          >
            Export CSV
          </button>
        </div>
      )}

      {/* Overall Progress Indicator */}
      {total > 0 && (
        <div className="mb-6 space-y-4">
          {/* Main Progress Bar */}
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 shadow-sm">
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-base font-semibold text-gray-900 dark:text-white">
                Overall Progress
              </h3>
              {allComplete ? (
                <span className="text-sm font-medium text-green-600 dark:text-green-400">
                  ✅ All Complete!
                </span>
              ) : (
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {completed} of {total} fully processed
                </span>
              )}
            </div>
            
            {/* Product Creation Progress */}
            <div className="mb-4">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  Products Created: {created} of {total}
                </span>
                <span className="text-sm font-medium text-gray-900 dark:text-white">
                  {Math.round(creationProgress)}%
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-3 dark:bg-gray-700">
                <div 
                  className={`h-3 rounded-full transition-all duration-500 ${
                    creationProgress === 100 
                      ? 'bg-green-600 dark:bg-green-500' 
                      : 'bg-blue-600 dark:bg-blue-500'
                  }`}
                  style={{ width: `${creationProgress}%` }}
                ></div>
              </div>
            </div>

            {/* Image Processing Progress */}
            {created > 0 && (
              <div>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    Images Processed: {completed} of {created}
                    {processing > 0 && (
                      <span className="text-gray-500 dark:text-gray-400 ml-2">
                        ({processing} still processing)
                      </span>
                    )}
                  </span>
                  <span className="text-sm font-medium text-gray-900 dark:text-white">
                    {Math.round(processingProgress)}%
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-3 dark:bg-gray-700">
                  <div 
                    className={`h-3 rounded-full transition-all duration-500 ${
                      processingProgress === 100 
                        ? 'bg-green-600 dark:bg-green-500' 
                        : 'bg-yellow-600 dark:bg-yellow-500'
                    }`}
                    style={{ width: `${processingProgress}%` }}
                  ></div>
                </div>
              </div>
            )}

            {/* Status Summary */}
            <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
              <div className="flex flex-wrap gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-green-500"></div>
                  <span className="text-gray-700 dark:text-gray-300">
                    Complete: <strong className="text-gray-900 dark:text-white">{completed}</strong>
                  </span>
                </div>
                {processing > 0 && (
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-yellow-500 animate-pulse"></div>
                    <span className="text-gray-700 dark:text-gray-300">
                      Processing: <strong className="text-gray-900 dark:text-white">{processing}</strong>
                    </span>
                  </div>
                )}
                {errors > 0 && (
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-red-500"></div>
                    <span className="text-gray-700 dark:text-gray-300">
                      Errors: <strong className="text-gray-900 dark:text-white">{errors}</strong>
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Completion Message */}
          {allComplete && (
            <div className="flex items-center p-4 text-sm text-green-800 rounded-lg bg-green-50 dark:bg-gray-800 dark:text-green-400 border border-green-200 dark:border-green-800" role="alert">
              <svg className="shrink-0 inline w-5 h-5 me-3" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <div>
                <span className="font-medium">All uploads complete!</span> All {total} product{total !== 1 ? 's' : ''} have been created and images have finished processing. You can now view them in the Gelato dashboard.
              </div>
            </div>
          )}
        </div>
      )}

      {/* Info about debugging */}
      {results.length > 0 && (
        <div className="mb-4 space-y-2">
          <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md">
            <p className="text-sm text-blue-900 dark:text-blue-300">
              <strong>Tip:</strong> Click on any row to expand and see detailed debugging information including what was sent to Gelato and the response received. 
              This helps diagnose issues like missing thumbnails or variants.
            </p>
          </div>
          {results.some(r => r.productId && r.status !== 'error') && (
            <>
              {images && images.some(img => img.sourceType === 'dropbox' || img.sourceType === 'googledrive') && (
                <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md">
                  <p className="text-sm text-blue-900 dark:text-blue-300">
                    <strong>✅ Safe to shutdown:</strong> Using cloud URLs (Dropbox/Google Drive). Gelato fetches images directly from the cloud. You can safely close this app immediately after submitting - processing continues on Gelato's servers.
                  </p>
                </div>
              )}
              {images && images.some(img => !img.sourceType || img.sourceType === 'local') && (
                <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-md">
                  <p className="text-sm text-yellow-900 dark:text-yellow-300">
                    <strong>⚠️ Keep app running:</strong> Some images are from local uploads. Keep your computer and tunnel running until Gelato finishes downloading (check server logs for <code className="bg-yellow-100 dark:bg-yellow-800 px-1 rounded">✅ GELATO FETCH DETECTED</code>). After that, processing continues on Gelato's servers.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Template ID - shown above table since all items use the same template */}
      {templateId && (
        <div className="mb-4">
          <span className="text-sm text-gray-700 dark:text-gray-300">
            <strong className="font-medium text-gray-900 dark:text-white">Template:</strong> {templateId}
          </span>
        </div>
      )}

      <div className="relative shadow-md sm:rounded-lg overflow-x-auto">
        <table className="w-full text-sm text-left rtl:text-right text-gray-500 dark:text-gray-400 table-fixed">
          <thead className="text-xs text-gray-700 uppercase bg-gray-50 dark:bg-gray-700 dark:text-gray-400">
            <tr>
              <th scope="col" className="px-6 py-3 w-1/3">
                Image & Product ID
              </th>
              <th scope="col" className="px-6 py-3 w-2/3">
                Status Message
              </th>
            </tr>
          </thead>
          <tbody>
            {results.map((result, index) => {
              const image = images?.[index];
              const isExpanded = expandedRows.has(index);
              
              // Truncate error/message for display
              const statusMessage = result.error || 
                (result.status === 'success' ? 'Product created successfully' : '') ||
                (result.status === 'warning' ? 'Processing in background' : '') ||
                (result.status === 'pending' ? 'Uploading...' : '');
              const truncatedMessage = statusMessage && statusMessage.length > 60 
                ? statusMessage.substring(0, 60) + '...' 
                : statusMessage;
              // Determine color based on status first, then message content
              // Priority: status field > message content
              const isError = result.status === 'error';
              const isSuccess = result.status === 'success' || (statusMessage && statusMessage.startsWith('✅'));
              const isWarning = result.status === 'warning' || 
                               result.status === 'pending' ||
                               (statusMessage && (
                                 statusMessage.startsWith('⏳') || 
                                 statusMessage.includes('Still processing') ||
                                 statusMessage.includes('Processing in')
                               ));
              
              return (
                <>
                  <tr 
                    key={index}
                    className={`bg-white border-b dark:bg-gray-800 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer ${index === results.length - 1 && !isExpanded ? 'border-b-0' : 'border-gray-200'}`}
                    onClick={() => {
                      const newExpanded = new Set(expandedRows);
                      if (isExpanded) {
                        newExpanded.delete(index);
                      } else {
                        newExpanded.add(index);
                      }
                      setExpandedRows(newExpanded);
                    }}
                  >
                    <th scope="row" className="px-6 py-4 font-medium text-gray-900 dark:text-white break-words" style={{ wordBreak: 'break-word' }}>
                      <div className="flex items-center space-x-3">
                        <div className="flex-shrink-0 text-gray-400 dark:text-gray-500">
                          {isExpanded ? (
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          ) : (
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          )}
                        </div>
                        {image ? (
                          <>
                            <div className="flex-shrink-0">
                              <img
                                src={image.publicUrl || image.fileId}
                                alt={image.originalName || image.fileId}
                                className="h-12 w-12 object-cover rounded-md border border-gray-300 dark:border-gray-600"
                              />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <div className="text-sm font-medium text-gray-900 dark:text-white truncate">
                                  {image.originalName || image.fileId}
                                </div>
                                {image.sourceType === 'dropbox' && (
                                  <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300" title="Dropbox URL">
                                    📦
                                  </span>
                                )}
                                {image.sourceType === 'googledrive' && (
                                  <span className="text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300" title="Google Drive URL">
                                    📦
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                Product ID: <span className="font-mono">{result.productId || 'Not created yet'}</span>
                              </div>
                              <div className={`text-xs mt-1 inline-flex px-2 py-0.5 rounded-full font-semibold ${getStatusColor(result.status)}`}>
                                {result.status}
                              </div>
                            </div>
                          </>
                        ) : (
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium text-gray-900 dark:text-white">{result.templateId}</div>
                            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                              Product ID: <span className="font-mono">{result.productId || 'Not created yet'}</span>
                            </div>
                            <div className={`text-xs mt-1 inline-flex px-2 py-0.5 rounded-full font-semibold ${getStatusColor(result.status)}`}>
                              {result.status}
                            </div>
                          </div>
                        )}
                      </div>
                    </th>
                    <td className="px-6 py-4 break-words" style={{ wordBreak: 'break-word' }}>
                      {statusMessage ? (
                        <div className="max-w-md">
                          <div className="flex items-center gap-2">
                            {(checkingStatusIndex === index || autoChecking.has(index)) && (
                              <div className="flex-shrink-0">
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 dark:border-blue-400"></div>
                              </div>
                            )}
                            <div 
                              className={`text-sm flex-1 ${
                                isError
                                  ? 'text-red-600 dark:text-red-400' 
                                  : isSuccess
                                  ? 'text-gray-900 dark:text-white'
                                  : isWarning
                                  ? 'text-orange-600 dark:text-orange-400'
                                  : 'text-gray-600 dark:text-gray-400'
                              }`}
                              title={statusMessage && statusMessage.length > 60 ? statusMessage : undefined}
                            >
                              {truncatedMessage}
                              {autoChecking.has(index) && (
                                <span className="ml-2 text-xs text-gray-500 dark:text-gray-400 italic">(auto-checking...)</span>
                              )}
                            </div>
                          </div>
                          {result.previewUrl && (
                            <a
                              href={result.previewUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-300 mt-1 block truncate"
                              onClick={(e) => e.stopPropagation()}
                            >
                              Preview
                            </a>
                          )}
                          {result.adminUrl && (
                            <a
                              href={result.adminUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-300 mt-1 block truncate"
                              onClick={(e) => e.stopPropagation()}
                            >
                              Admin
                            </a>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-400 dark:text-gray-500">-</span>
                      )}
                    </td>
                  </tr>
                {isExpanded && (
                  <tr key={`${index}-details`} className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
                    <td colSpan={2} className="px-6 py-4 break-words" style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
                      <div className="space-y-3 text-xs">
                        {/* Action Buttons at top of expanded row */}
                        {(() => {
                          const buttons: React.ReactNode[] = [];
                          if (result.productId) {
                            buttons.push(
                              <div key="check-status" className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleCheckStatus(index, false);
                                  }}
                                  disabled={checkingStatusIndex === index || autoChecking.has(index)}
                                  className="text-white bg-gray-900 dark:bg-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-100 focus:ring-4 focus:outline-none focus:ring-gray-300 dark:focus:ring-gray-700 font-medium rounded-lg text-sm px-4 py-2 text-center disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  {checkingStatusIndex === index ? 'Checking...' : autoChecking.has(index) ? 'Auto-checking...' : 'Check Status'}
                                </button>
                                {autoChecking.has(index) && (
                                  <span className="text-xs text-gray-600 dark:text-gray-400 italic">
                                    (Auto-checking every 3 min)
                                  </span>
                                )}
                              </div>
                            );
                          }
                          if (result.status === 'error') {
                            buttons.push(
                              <button
                                key="retry"
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRetry(index);
                                }}
                                disabled={retryingIndex === index}
                                className="text-white bg-gradient-to-r from-brand via-brand-dark to-brand-accent hover:bg-gradient-to-br focus:ring-4 focus:outline-none focus:ring-brand/30 dark:focus:ring-brand/50 font-medium rounded-lg text-sm px-4 py-2 text-center disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {retryingIndex === index ? 'Retrying...' : 'Retry'}
                              </button>
                            );
                          }
                          return buttons.length > 0 ? (
                            <div className="flex gap-2 pb-3 border-b border-gray-200 dark:border-gray-700">
                              {buttons}
                            </div>
                          ) : null;
                        })()}
                        
                        {/* Diagnostic Messages - always visible when row is expanded */}
                        {result.responseReceived && typeof result.responseReceived === 'object' && result.responseReceived !== null ? ((): React.ReactNode => {
                          const response = result.responseReceived as any;
                          const variants = Array.isArray(response.variants) ? response.variants : [];
                          const productImages = Array.isArray(response.productImages) ? response.productImages : [];
                          const variantsCount = variants.length;
                          const productImagesCount = productImages.length;
                          const isCreated = response.status === 'created';
                          const isReady = response.isReadyToPublish === true;
                          const isProcessing = isCreated && !isReady;
                          const hasProgress = variantsCount > 0 || productImagesCount > 0;
                          
                          // Case 1: Processing complete - only when isReadyToPublish is true
                          if (isReady && hasProgress) {
                            return (
                              <div className="space-y-2 pb-3 border-b border-gray-200 dark:border-gray-700">
                                <div className="p-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded text-green-800 dark:text-green-300 text-xs">
                                  <strong>✅ Processing Complete!</strong> Gelato has successfully processed your images and all variants are connected.
                                  <br />
                                  • Variants created and connected: {variantsCount}
                                  <br />
                                  • Product images: {productImagesCount}
                                  <span className="block mt-2 font-semibold">🎉 Ready to publish!</span>
                                </div>
                              </div>
                            );
                          }
                          
                          // Case 2: Still processing (status=created, not ready)
                          if (isProcessing) {
                            // Has variants/images but not ready - variants are created but not connected yet
                            if (hasProgress) {
                              return (
                                <div className="space-y-2 pb-3 border-b border-gray-200 dark:border-gray-700">
                                  <div className="p-2 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded text-yellow-800 dark:text-yellow-300 text-xs">
                                    <strong>⏳ Variants Created, Connecting...</strong> Gelato has created {variantsCount} variant{variantsCount !== 1 ? 's' : ''} but they're not fully connected yet.
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
                                    <strong className="text-blue-700 dark:text-blue-400">💡 You can safely close this app - processing continues on Gelato's servers!</strong>
                                  </div>
                                </div>
                              );
                            }
                            
                            // Early stage: no variants or images yet
                            if (variantsCount === 0 && productImagesCount === 0) {
                              return (
                                <div className="space-y-2 pb-3 border-b border-gray-200 dark:border-gray-700">
                                  <div className="p-2 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded text-yellow-800 dark:text-yellow-300 text-xs">
                                    <strong>⏳ Processing in Early Stage:</strong> Gelato has received your product and is downloading/processing the images.
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
                                    <strong className="text-blue-700 dark:text-blue-400">💡 You can safely close this app - processing continues on Gelato's servers!</strong>
                                  </div>
                                </div>
                              );
                            }
                            
                            // Partial progress: has some data but not complete
                            return (
                              <div className="space-y-2 pb-3 border-b border-gray-200 dark:border-gray-700">
                                <div className="p-2 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded text-yellow-800 dark:text-yellow-300 text-xs">
                                  <strong>⏳ Processing in Progress:</strong> Gelato is currently processing your images.
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
                                  <br />
                                  <strong className="text-blue-700 dark:text-blue-400">💡 You can safely close this app - processing continues on Gelato's servers!</strong>
                                </div>
                              </div>
                            );
                          }
                          
                          // Case 3: Processing completed but no variants/images - possible error
                          if (!isProcessing && variantsCount === 0 && productImagesCount === 0) {
                            return (
                              <div className="space-y-2 pb-3 border-b border-gray-200 dark:border-gray-700">
                                <div className="p-2 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded text-orange-800 dark:text-orange-300 text-xs">
                                  <strong>⚠️ Processing Issue Detected:</strong> Gelato returned an empty variants array and no product images. This typically means images weren't processed successfully.
                                  <br />
                                  <br />
                                  <strong>Possible causes:</strong>
                                  <ul className="list-disc list-inside mt-1 space-y-1">
                                    <li>Tunnel not accessible (if using ngrok/localtunnel - check it's still running)</li>
                                    <li>Image URLs expired (your server's temporary URLs may have timed out)</li>
                                    <li>Gelato can't reach your server (network/firewall issue)</li>
                                    <li>Image file corrupted or incomplete</li>
                                  </ul>
                                  <br />
                                  <strong>How to diagnose:</strong>
                                  <ul className="list-disc list-inside mt-1 space-y-1">
                                    <li>Check the "Image URL Sent" preview below - if it fails to load or shows black areas, the original file may be corrupted</li>
                                    <li>Check your server logs to see if Gelato attempted to fetch the images</li>
                                    <li>Verify your tunnel (if using one) is still active and accessible</li>
                                    <li>Try clicking <strong>"Retry"</strong> to re-upload the product</li>
                                  </ul>
                                </div>
                              </div>
                            );
                          }
                          
                          // Case 4: Unknown status - show general info
                          return (
                            <div className="space-y-2 pb-3 border-b border-gray-200 dark:border-gray-700">
                              <div className="p-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded text-gray-700 dark:text-gray-300 text-xs">
                                <strong>Status:</strong> Product status: {response.status || 'unknown'}, Ready: {isReady ? 'Yes' : 'No'}
                                <br />
                                Variants: {variantsCount}, Product Images: {productImagesCount}
                                <br />
                                Click <strong>"Check Status"</strong> to get the latest information from Gelato.
                              </div>
                            </div>
                          );
                        })() : null}
                        
                        <div>
                          <strong className="text-gray-900 dark:text-white">Image URL Sent:</strong>
                          {result.imageUrlSent ? (
                            <>
                            <div className="mt-1 space-y-2">
                              <div>
                                <a
                                  href={result.imageUrlSent}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-300 break-all"
                                >
                                  {result.imageUrlSent}
                                </a>
                                <span className="ml-2 text-gray-500 dark:text-gray-400">(Click to test if accessible)</span>
                              </div>
                              <div className="mt-2 p-2 bg-gray-100 dark:bg-gray-800 rounded border border-gray-300 dark:border-gray-600">
                                <div className="text-xs text-gray-600 dark:text-gray-400 mb-1 font-medium">
                                  Original Image Preview (verify it looks correct):
                                </div>
                                <div className="relative">
                                  <img
                                    src={result.imageUrlSent}
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
                            </>
                          ) : (
                            <span className="text-gray-500 dark:text-gray-400 ml-2">Not available</span>
                          )}
                        </div>
                        {result.payloadSent ? ((): React.ReactNode => (
                          <div>
                            <button
                              type="button"
                              onClick={() => toggleSection(`payload-${index}`)}
                              className="flex items-center gap-2 text-gray-900 dark:text-white hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                            >
                              <svg 
                                className={`w-4 h-4 transition-transform ${isSectionExpanded(`payload-${index}`) ? 'rotate-90' : ''}`}
                                fill="none" 
                                stroke="currentColor" 
                                viewBox="0 0 24 24"
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                              </svg>
                              <strong>Payload Sent to Gelato:</strong>
                            </button>
                            {isSectionExpanded(`payload-${index}`) ? (
                              <pre className="mt-1 p-2 bg-gray-100 dark:bg-gray-800 rounded text-xs overflow-x-auto">
                                {JSON.stringify(result.payloadSent, null, 2)}
                              </pre>
                            ) : null}
                          </div>
                        ))() : null}
                        {result.responseReceived ? (
                          <div>
                            <button
                              type="button"
                              onClick={() => toggleSection(`response-${index}`)}
                              className="flex items-center gap-2 text-gray-900 dark:text-white hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                            >
                              <svg 
                                className={`w-4 h-4 transition-transform ${isSectionExpanded(`response-${index}`) ? 'rotate-90' : ''}`}
                                fill="none" 
                                stroke="currentColor" 
                                viewBox="0 0 24 24"
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                              </svg>
                              <strong>Response from Gelato:</strong>
                            </button>
                            {isSectionExpanded(`response-${index}`) && (
                              <pre className="mt-1 p-2 bg-gray-100 dark:bg-gray-800 rounded text-xs overflow-x-auto">
                                {JSON.stringify(result.responseReceived, null, 2)}
                              </pre>
                            )}
                          </div>
                        ) : null}
                        {result.errorDetails && (
                          <div>
                            <strong className="text-red-600 dark:text-red-400">Error Details:</strong>
                            <pre className="mt-1 p-2 bg-red-50 dark:bg-red-900/20 rounded text-xs overflow-x-auto text-red-800 dark:text-red-300">
                              {JSON.stringify(result.errorDetails, null, 2)}
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

        {results.length === 0 && (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            No results yet. Start creating products to see results here.
          </div>
        )}
      </div>
    </div>
  );
}

