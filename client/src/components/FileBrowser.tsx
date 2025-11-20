import { useState, useRef, useEffect, useCallback } from 'react';
import type { UploadedFile } from '../lib/types';
import { getCloudCredentials, saveCloudCredentials } from '../lib/storage';
import { listDropboxFiles, getDropboxDownloadLink, listGoogleDriveFiles, getGoogleDriveDownloadLink, refreshDropboxToken } from '../lib/api';

type FileBrowserProps = {
  onFilesAdded: (files: File[]) => void;
  onCloudUrlsAdded?: (urls: Array<{ url: string; name: string; sourceType: 'dropbox' | 'googledrive' }>) => void;
  initialTab?: 'local' | 'dropbox' | 'googledrive';
  onSelectedFilesChange?: (count: number, addHandler: () => Promise<void>) => void;
};

type UploadMethod = 'local' | 'dropbox' | 'googledrive';

type CloudFile = {
  id: string;
  name: string;
  path?: string;
  size?: number | string;
  modified?: string;
  sourceType: 'dropbox' | 'googledrive';
  type?: 'file' | 'folder';
};

export default function FileBrowser({ onFilesAdded, onCloudUrlsAdded, initialTab, onSelectedFilesChange }: FileBrowserProps) {
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Cloud file browsing state
  const [dropboxFiles, setDropboxFiles] = useState<CloudFile[]>([]);
  const [dropboxFolders, setDropboxFolders] = useState<CloudFile[]>([]);
  const [googleDriveFiles, setGoogleDriveFiles] = useState<CloudFile[]>([]);
  const [selectedCloudFiles, setSelectedCloudFiles] = useState<Set<string>>(new Set());
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  
  // Preview modal state
  const [previewImage, setPreviewImage] = useState<{ url: string; name: string } | null>(null);
  
  // State to track credential updates and trigger re-renders
  const [credentialsVersion, setCredentialsVersion] = useState(0);
  
  // Get credentials and compute connection status (re-computes when credentialsVersion changes)
  let credentials: ReturnType<typeof getCloudCredentials>;
  let isDropboxConnected = false;
  let isGoogleDriveConnected = false;
  
  try {
    credentials = getCloudCredentials();
    isDropboxConnected = !!credentials?.dropboxAccessToken && 
      (!credentials.dropboxTokenExpiry || credentials.dropboxTokenExpiry > Date.now());
    isGoogleDriveConnected = !!credentials?.googleDriveAccessToken && 
      (!credentials.googleDriveTokenExpiry || credentials.googleDriveTokenExpiry > Date.now());
  } catch (err) {
    console.error('Error getting cloud credentials:', err);
    credentials = {} as ReturnType<typeof getCloudCredentials>;
  }
  
  // Force re-computation of connection status when credentialsVersion changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    // This effect runs when credentialsVersion changes, triggering a re-render
    // which will re-compute isDropboxConnected and isGoogleDriveConnected
  }, [credentialsVersion]);
  
  const getDefaultTab = (): UploadMethod => {
    if (initialTab) return initialTab;
    if (isDropboxConnected) return 'dropbox';
    if (isGoogleDriveConnected) return 'googledrive';
    return 'local';
  };

  const [uploadMethod, setUploadMethod] = useState<UploadMethod>(getDefaultTab());
  
  // Load saved folder paths from credentials
  const [currentDropboxPath, setCurrentDropboxPath] = useState<string>(() => {
    try {
      const creds = getCloudCredentials();
      return creds?.dropboxLastPath || '';
    } catch {
      return '';
    }
  });
  const [currentGoogleDriveFolderId, setCurrentGoogleDriveFolderId] = useState<string>(() => {
    try {
      const creds = getCloudCredentials();
      return creds?.googleDriveLastFolderId || 'root';
    } catch {
      return 'root';
    }
  });
  
  // Save folder paths when they change
  const saveDropboxPath = (path: string) => {
    setCurrentDropboxPath(path);
    const creds = getCloudCredentials();
    saveCloudCredentials({
      ...creds,
      dropboxLastPath: path,
    });
  };
  

  // Check for OAuth errors from URL params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const dropboxError = params.get('dropbox_auth_error');
    const googleError = params.get('googledrive_auth_error');
    
    if (dropboxError && uploadMethod === 'dropbox') {
      if (dropboxError.includes('access_denied') || dropboxError.includes('invalid')) {
        setError(
          'Dropbox OAuth Error\n\n' +
          'To fix this, configure your Dropbox app:\n\n' +
          '1. Go to: https://www.dropbox.com/developers/apps\n' +
          '2. Click on your app (or create one if needed)\n' +
          '3. Go to Settings tab\n' +
          '4. Under "OAuth 2", add Redirect URI:\n' +
          '   http://localhost:5175/api/dropbox/callback\n' +
          '   (or your production URL if using a tunnel)\n' +
          '5. Save changes\n' +
          '6. Make sure "App key" (Client ID) matches: vjyl672abot2sek\n' +
          '7. Try connecting again'
        );
      } else {
        setError(`Dropbox authentication failed: ${dropboxError}`);
      }
      // Clean URL
      const newParams = new URLSearchParams(window.location.search);
      newParams.delete('dropbox_auth_error');
      const newUrl = newParams.toString() 
        ? `${window.location.pathname}?${newParams.toString()}`
        : window.location.pathname;
      window.history.replaceState({}, '', newUrl);
    }
    
    if (googleError && uploadMethod === 'googledrive') {
      if (googleError.includes('access_denied') || googleError.includes('invalid')) {
        setError(
          'Google Drive OAuth Error: Missing Required Fields\n\n' +
          'You need to complete the OAuth consent screen configuration:\n\n' +
          '1. Go to: https://console.cloud.google.com/apis/credentials/consent\n\n' +
          '2. Fill in REQUIRED fields:\n' +
          '   - App name: Podmate\n' +
          '   - User support email: your-email@example.com\n' +
          '   - Developer contact: your-email@example.com\n' +
          '   - Application logo: (optional, can skip)\n' +
          '   - Home page URL: http://localhost:5174\n' +
          '   - Privacy Policy URL: (can use a placeholder for testing)\n' +
          '   - Terms of Service URL: (can use a placeholder for testing)\n' +
          '   - Application category: Productivity or Other\n\n' +
          '3. For Scope "drive.readonly", fill in:\n' +
          '   - Scope justification: "Allow users to browse and select their own Google Drive files to upload images for print-on-demand products"\n' +
          '   - Intended data usage: "The app reads file metadata and downloads image files selected by the user from their Google Drive account. Files are temporarily cached for processing and uploaded to print-on-demand service. No data is stored permanently."\n' +
          '   - Demo video: (optional for Testing mode - can skip)\n\n' +
          '4. Set Publishing status to "Testing" and add your Google email as a Test User\n\n' +
          '5. Save and try connecting again'
        );
      } else {
        setError(`Google Drive authentication failed: ${googleError}`);
      }
      // Clean URL
      const newParams = new URLSearchParams(window.location.search);
      newParams.delete('googledrive_auth_error');
      const newUrl = newParams.toString() 
        ? `${window.location.pathname}?${newParams.toString()}`
        : window.location.pathname;
      window.history.replaceState({}, '', newUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadMethod]);

  // Track if files have been loaded and last path to prevent duplicate loads
  const filesLoadedRef = useRef<{ dropbox: string | null; googledrive: string | null }>({ dropbox: null, googledrive: null });
  const tokenRefreshAttemptedRef = useRef<{ dropbox: boolean; googledrive: boolean }>({ dropbox: false, googledrive: false });

  // Automatically refresh tokens on mount if they're expired or close to expiry
  useEffect(() => {
    const refreshTokensIfNeeded = async () => {
      const creds = getCloudCredentials();
      const now = Date.now();
      const REFRESH_THRESHOLD = 5 * 60 * 1000; // Refresh if expiring within 5 minutes

      // Check and refresh Dropbox token if needed
      if (creds.dropboxAccessToken && creds.dropboxRefreshToken && !tokenRefreshAttemptedRef.current.dropbox) {
        const isExpired = !creds.dropboxTokenExpiry || creds.dropboxTokenExpiry <= now;
        const isExpiringSoon = creds.dropboxTokenExpiry && (creds.dropboxTokenExpiry - now) < REFRESH_THRESHOLD;

        if (isExpired || isExpiringSoon) {
          tokenRefreshAttemptedRef.current.dropbox = true;
          try {
            console.log('Dropbox token expired or expiring soon, automatically refreshing...');
            const refreshResult = await refreshDropboxToken(creds.dropboxRefreshToken);
            
            saveCloudCredentials({
              ...creds,
              dropboxAccessToken: refreshResult.access_token,
              dropboxTokenExpiry: refreshResult.expiryTime,
            });
            
            // Trigger re-render to update connection status
            setCredentialsVersion(prev => prev + 1);
            
            console.log('Dropbox token refreshed successfully');
          } catch (err) {
            console.error('Failed to automatically refresh Dropbox token:', err);
            // Token refresh failed - user will need to reconnect
            // Clear invalid tokens so they're prompted to reconnect
            saveCloudCredentials({
              ...creds,
              dropboxAccessToken: undefined,
              dropboxRefreshToken: undefined,
              dropboxTokenExpiry: undefined,
            });
            
            // Trigger re-render to update connection status
            setCredentialsVersion(prev => prev + 1);
          }
        }
      }

      // Check and refresh Google Drive token if needed (similar logic for Google Drive)
      // Note: Google Drive token refresh would need to be implemented similarly
      // For now, we'll just handle Dropbox
    };

    refreshTokensIfNeeded();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  // Load files when tab changes and user is connected (use saved paths)
  useEffect(() => {
    try {
      const savedCredentials = getCloudCredentials();
      if (uploadMethod === 'dropbox' && isDropboxConnected && dropboxFiles.length === 0 && dropboxFolders.length === 0) {
        // Load from saved path or root
        const pathToLoad = savedCredentials.dropboxLastPath || '';
        if (pathToLoad !== currentDropboxPath) {
          setCurrentDropboxPath(pathToLoad);
        }
        // Only load if we haven't loaded this path yet
        if (filesLoadedRef.current.dropbox !== pathToLoad) {
          filesLoadedRef.current.dropbox = pathToLoad;
          loadDropboxFiles();
        }
      } else if (uploadMethod === 'googledrive' && isGoogleDriveConnected && googleDriveFiles.length === 0) {
        // Load from saved folder or root
        const folderToLoad = savedCredentials.googleDriveLastFolderId || 'root';
        if (folderToLoad !== currentGoogleDriveFolderId) {
          setCurrentGoogleDriveFolderId(folderToLoad);
        }
        // Only load if we haven't loaded this folder yet
        if (filesLoadedRef.current.googledrive !== folderToLoad) {
          filesLoadedRef.current.googledrive = folderToLoad;
          loadGoogleDriveFiles();
        }
      }
      
      // Reset flags when switching tabs
      if (uploadMethod !== 'dropbox') {
        filesLoadedRef.current.dropbox = null;
      }
      if (uploadMethod !== 'googledrive') {
        filesLoadedRef.current.googledrive = null;
      }
    } catch (err) {
      console.error('Error in file loading useEffect:', err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadMethod, isDropboxConnected, isGoogleDriveConnected]);

  // Load files when path changes (for navigation, but only if path actually changed)
  const prevDropboxPathRef = useRef<string>(currentDropboxPath);
  useEffect(() => {
    if (uploadMethod === 'dropbox' && isDropboxConnected && currentDropboxPath !== undefined) {
      // Only reload if path actually changed (not initial mount)
      if (prevDropboxPathRef.current !== currentDropboxPath && prevDropboxPathRef.current !== undefined) {
        filesLoadedRef.current.dropbox = currentDropboxPath;
        loadDropboxFiles();
      }
      prevDropboxPathRef.current = currentDropboxPath;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDropboxPath, uploadMethod, isDropboxConnected]);

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    handleFiles(files);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    handleFiles(files);
  };

  const handleFiles = (files: File[]) => {
    if (files.length === 0) return;

    setError(null);
    
    // Filter to only image files
    const imageFiles = files.filter(file => {
      const type = file.type.toLowerCase();
      return type.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp'].some(ext => 
        file.name.toLowerCase().endsWith(`.${ext}`)
      );
    });

    if (imageFiles.length === 0) {
      setError('Please select image files only');
      return;
    }

    if (imageFiles.length < files.length) {
      setError(`Some files were not images and were skipped. ${imageFiles.length} image(s) added.`);
    }

    onFilesAdded(imageFiles);

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // OAuth connection handlers
  const handleConnectDropbox = () => {
    window.location.href = '/api/dropbox/auth';
  };

  const handleConnectGoogleDrive = () => {
    window.location.href = '/api/googledrive/auth';
  };

  // File loading handlers
  const loadDropboxFiles = async () => {
    // Refresh credentials in case they were just saved
    let freshCredentials = getCloudCredentials();
    
    if (!freshCredentials.dropboxAccessToken) {
      setError('Not connected to Dropbox. Please connect first.');
      return;
    }

    setLoadingFiles(true);
    setError(null);
    try {
      console.log(`Loading Dropbox files from path: "${currentDropboxPath}"`);
      let result;
      try {
        result = await listDropboxFiles(freshCredentials.dropboxAccessToken, currentDropboxPath);
      } catch (err) {
        // Check if token expired (401 error with expired_access_token)
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        if (errorMessage.includes('401') || errorMessage.includes('expired_access_token')) {
          // Try to refresh the token
          if (freshCredentials.dropboxRefreshToken) {
            console.log('Dropbox token expired, attempting to refresh...');
            try {
              const refreshResult = await refreshDropboxToken(freshCredentials.dropboxRefreshToken);
              
              // Update stored credentials with new token
              freshCredentials = {
                ...freshCredentials,
                dropboxAccessToken: refreshResult.access_token,
                dropboxTokenExpiry: refreshResult.expiryTime,
              };
              saveCloudCredentials(freshCredentials);
              
              // Retry the request with new token
              console.log('Token refreshed, retrying file list...');
              result = await listDropboxFiles(freshCredentials.dropboxAccessToken, currentDropboxPath);
            } catch (refreshErr) {
              console.error('Failed to refresh Dropbox token:', refreshErr);
              setError('Your Dropbox session expired. Please reconnect to Dropbox.');
              return;
            }
          } else {
            setError('Your Dropbox session expired. Please reconnect to Dropbox.');
            return;
          }
        } else {
          throw err; // Re-throw if it's not a token expiration error
        }
      }
      
      console.log(`Dropbox API returned ${result.folders?.length || 0} folders and ${result.files.length} image files`);
      
      if (result.files.length === 0 && (result.folders?.length || 0) === 0) {
        setError('No files or folders found. Make sure you have image files (JPG, PNG, GIF, etc.) in your Dropbox.');
      } else {
        setError(null);
      }
      
      setDropboxFolders((result.folders || []).map(f => ({
        id: f.path || f.id,
        name: f.name,
        path: f.path,
        sourceType: 'dropbox' as const,
        type: 'folder' as const,
      })));
      
      const newFiles = result.files.map(f => ({
        id: f.path || f.id,
        name: f.name,
        path: f.path,
        size: f.size,
        modified: f.modified,
        sourceType: 'dropbox' as const,
        type: 'file' as const,
      }));
      setDropboxFiles(newFiles);
      
      // Preserve selections that still exist in the new file list
      setSelectedCloudFiles(prev => {
        const newFileIds = new Set(newFiles.map(f => f.id));
        const preservedSelections = new Set(
          Array.from(prev).filter(id => newFileIds.has(id))
        );
        return preservedSelections;
      });
      
      setLastSelectedIndex(null); // Reset last selected index when files reload
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error('Error loading Dropbox files:', err);
      setError(`Failed to load Dropbox files: ${errorMessage}. Check the browser console for details.`);
    } finally {
      setLoadingFiles(false);
    }
  };

  const loadGoogleDriveFiles = async () => {
    // Refresh credentials in case they were just saved
    const freshCredentials = getCloudCredentials();
    
    if (!freshCredentials.googleDriveAccessToken) {
      setError('Not connected to Google Drive. Please connect first.');
      return;
    }

    setLoadingFiles(true);
    setError(null);
    try {
      console.log(`Loading Google Drive files from folder: "${currentGoogleDriveFolderId}"`);
      const result = await listGoogleDriveFiles(freshCredentials.googleDriveAccessToken, currentGoogleDriveFolderId);
      console.log(`Google Drive API returned ${result.files.length} image files`);
      
      if (result.files.length === 0) {
        setError('No image files found in your Google Drive root folder. Make sure you have image files (JPG, PNG, GIF, etc.) in your Google Drive.');
      } else {
        setError(null);
      }
      
      const newFiles = result.files.map(f => ({
        id: f.id,
        name: f.name,
        size: f.size,
        modified: f.modified,
        sourceType: 'googledrive' as const,
      }));
      setGoogleDriveFiles(newFiles);
      
      // Preserve selections that still exist in the new file list
      setSelectedCloudFiles(prev => {
        const newFileIds = new Set(newFiles.map(f => f.id));
        const preservedSelections = new Set(
          Array.from(prev).filter(id => newFileIds.has(id))
        );
        return preservedSelections;
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error('Error loading Google Drive files:', err);
      setError(`Failed to load Google Drive files: ${errorMessage}. Check the browser console for details.`);
    } finally {
      setLoadingFiles(false);
    }
  };

  // Handle cloud file selection
  const toggleFileSelection = (fileId: string, index: number, shiftKey: boolean = false) => {
    setSelectedCloudFiles(prev => {
      const next = new Set(prev);
      
      // Handle shift+click for range selection (only for Dropbox)
      if (shiftKey && lastSelectedIndex !== null && uploadMethod === 'dropbox' && dropboxFiles.length > 0) {
        const files = dropboxFiles;
        const startIndex = Math.min(lastSelectedIndex, index);
        const endIndex = Math.max(lastSelectedIndex, index);
        
        // Select all files in the range
        for (let i = startIndex; i <= endIndex; i++) {
          if (files[i]) {
            next.add(files[i].id);
          }
        }
      } else {
        // Normal toggle behavior
        if (next.has(fileId)) {
          next.delete(fileId);
        } else {
          next.add(fileId);
        }
      }
      
      return next;
    });
    
    // Update last selected index only if not shift-clicking
    if (!shiftKey || lastSelectedIndex === null) {
      setLastSelectedIndex(index);
    }
  };

  // Add selected cloud files
  const handleAddSelectedCloudFiles = useCallback(async () => {
    if (selectedCloudFiles.size === 0) {
      setError('Please select at least one file');
      return;
    }

    setLoadingFiles(true);
    setError(null);

    try {
      const files = uploadMethod === 'dropbox' ? dropboxFiles : googleDriveFiles;
      const selectedFiles = files.filter(f => selectedCloudFiles.has(f.id));
      const validUrls: Array<{ url: string; name: string; sourceType: 'dropbox' | 'googledrive' }> = [];

      let currentCredentials = getCloudCredentials();
      for (const file of selectedFiles) {
        try {
          if (file.sourceType === 'dropbox' && currentCredentials.dropboxAccessToken && file.path) {
            let result;
            try {
              result = await getDropboxDownloadLink(currentCredentials.dropboxAccessToken, file.path);
            } catch (err) {
              // Check if token expired
              const errorMessage = err instanceof Error ? err.message : 'Unknown error';
              if (errorMessage.includes('401') || errorMessage.includes('expired_access_token')) {
                // Try to refresh the token
                if (currentCredentials.dropboxRefreshToken) {
                  try {
                    const refreshResult = await refreshDropboxToken(currentCredentials.dropboxRefreshToken);
                    currentCredentials = {
                      ...currentCredentials,
                      dropboxAccessToken: refreshResult.access_token,
                      dropboxTokenExpiry: refreshResult.expiryTime,
                    };
                    saveCloudCredentials(currentCredentials);
                    // Retry with new token
                    result = await getDropboxDownloadLink(currentCredentials.dropboxAccessToken!, file.path);
                  } catch (refreshErr) {
                    console.error(`Failed to refresh token for ${file.name}:`, refreshErr);
                    continue; // Skip this file
                  }
                } else {
                  console.error(`Token expired and no refresh token for ${file.name}`);
                  continue; // Skip this file
                }
              } else {
                throw err; // Re-throw if not token expiration
              }
            }
            validUrls.push({
              url: result.link,
              name: file.name,
              sourceType: 'dropbox',
            });
          } else if (file.sourceType === 'googledrive' && currentCredentials.googleDriveAccessToken) {
            const result = await getGoogleDriveDownloadLink(currentCredentials.googleDriveAccessToken, file.id);
            validUrls.push({
              url: result.link,
              name: file.name,
              sourceType: 'googledrive',
            });
          }
        } catch (err) {
          console.error(`Failed to get download link for ${file.name}:`, err);
        }
      }

      if (validUrls.length > 0 && onCloudUrlsAdded) {
        onCloudUrlsAdded(validUrls);
        setSelectedCloudFiles(new Set());
        setError(null);
      } else {
        setError('Failed to get download links for selected files');
      }
    } catch (err) {
      setError(`Failed to add files: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setLoadingFiles(false);
    }
  }, [selectedCloudFiles, uploadMethod, dropboxFiles, googleDriveFiles, onCloudUrlsAdded]);

  // Expose selected files count and add handler to parent (after handleAddSelectedCloudFiles is defined)
  useEffect(() => {
    // Only call if callback is provided and handler is defined
    if (onSelectedFilesChange) {
      if (selectedCloudFiles.size > 0 && typeof handleAddSelectedCloudFiles === 'function') {
        try {
          onSelectedFilesChange(selectedCloudFiles.size, handleAddSelectedCloudFiles);
        } catch (err) {
          console.error('Error in onSelectedFilesChange:', err);
        }
      } else {
        // Reset when no files selected
        onSelectedFilesChange(0, async () => {});
      }
    }
    // Include handleAddSelectedCloudFiles to ensure parent always has latest version
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCloudFiles.size, handleAddSelectedCloudFiles]);

  const formatFileSize = (bytes?: number | string): string => {
    if (!bytes) return '';
    const numBytes = typeof bytes === 'string' ? parseInt(bytes) : bytes;
    if (numBytes < 1024) return `${numBytes} B`;
    if (numBytes < 1024 * 1024) return `${(numBytes / 1024).toFixed(1)} KB`;
    return `${(numBytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="h-full flex flex-col">
      {/* Upload Method Tabs */}
      <div className="mb-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
        <nav className="flex -mb-px" aria-label="Tabs">
          <button
            onClick={() => setUploadMethod('local')}
            className={`py-2 px-4 text-sm font-medium border-b-2 ${
              uploadMethod === 'local'
                ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
            }`}
          >
            Local Files
          </button>
          <button
            onClick={() => setUploadMethod('dropbox')}
            className={`py-2 px-4 text-sm font-medium border-b-2 ${
              uploadMethod === 'dropbox'
                ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
            }`}
          >
            Dropbox
          </button>
          <button
            onClick={() => setUploadMethod('googledrive')}
            className={`py-2 px-4 text-sm font-medium border-b-2 ${
              uploadMethod === 'googledrive'
                ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
            }`}
          >
            Google Drive
          </button>
        </nav>
      </div>
      
      {/* Tab Content */}
      <div className="flex-1 min-h-0 flex flex-col">

      {/* Local File Upload */}
      {uploadMethod === 'local' && (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onDragEnter={(e) => e.preventDefault()}
          className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-8 text-center hover:border-indigo-500 transition-colors"
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*"
            onChange={handleFileSelect}
            className="hidden"
            id="file-upload"
          />
          <label
            htmlFor="file-upload"
            className="cursor-pointer block"
          >
            <svg
              className="mx-auto h-12 w-12 text-gray-400 dark:text-gray-500"
              stroke="currentColor"
              fill="none"
              viewBox="0 0 48 48"
            >
              <path
                d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8m0-8h8m-8 0H12"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="mt-2 block text-sm font-medium text-gray-900 dark:text-white">
              Drag and drop images here, or click to browse
            </span>
          </label>
        </div>
      )}

      {/* Dropbox */}
      {uploadMethod === 'dropbox' && (
        <div className="flex flex-col flex-1 min-h-0">
          {!isDropboxConnected ? (
            <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-8 text-center">
              <svg className="mx-auto h-12 w-12 text-gray-400 dark:text-gray-500 mb-4" fill="currentColor" viewBox="0 0 20 20">
                <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
              </svg>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                Connect your Dropbox account to browse and select files.
              </p>
              <button
                onClick={handleConnectDropbox}
                className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 font-medium"
              >
                Connect Dropbox
              </button>
            </div>
          ) : (
            <div className="flex flex-col flex-1 min-h-0 space-y-4">
              <div className="flex justify-between items-center flex-shrink-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-green-600 dark:text-green-400 font-medium">✓ Connected to Dropbox</span>
                  <button
                    onClick={loadDropboxFiles}
                    disabled={loadingFiles}
                    className="px-3 py-1 text-sm text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50"
                  >
                    {loadingFiles ? 'Loading...' : 'Refresh'}
                  </button>
                </div>
              </div>
              
              {/* Breadcrumb navigation */}
              {currentDropboxPath && (
                <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 flex-shrink-0">
                  <button
                    onClick={() => {
                      // Clear selections when navigating up
                      setSelectedCloudFiles(new Set());
                      setLastSelectedIndex(null);
                      const parentPath = currentDropboxPath.split('/').slice(0, -1).join('/') || '';
                      saveDropboxPath(parentPath);
                      setTimeout(() => loadDropboxFiles(), 100);
                    }}
                    className="hover:text-indigo-600 dark:hover:text-indigo-400"
                  >
                    ← Up
                  </button>
                  <span>/</span>
                  <span className="font-medium">{currentDropboxPath || 'Root'}</span>
                </div>
              )}
              
              {loadingFiles && dropboxFiles.length === 0 && dropboxFolders.length === 0 ? (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400">Loading files...</div>
              ) : dropboxFiles.length === 0 && dropboxFolders.length === 0 ? (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400">No image files found. Click "Refresh" to load files.</div>
              ) : (
                <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden flex-1 min-h-0 flex flex-col">
                  <div className="flex-1 overflow-y-auto">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                      <thead className="bg-gray-50 dark:bg-gray-700 sticky top-0 z-10">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-12">
                            <input
                              type="checkbox"
                              checked={selectedCloudFiles.size === dropboxFiles.length && dropboxFiles.length > 0}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedCloudFiles(new Set(dropboxFiles.map(f => f.id)));
                                  setLastSelectedIndex(null);
                                } else {
                                  setSelectedCloudFiles(new Set());
                                  setLastSelectedIndex(null);
                                }
                              }}
                              className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                            />
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-20">Preview</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Name</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Size</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Modified</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                        {/* Folders first */}
                        {dropboxFolders.map((folder) => (
                          <tr 
                            key={folder.id} 
                            className="hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
                            onClick={() => {
                              // Clear selections when navigating to a different folder
                              setSelectedCloudFiles(new Set());
                              setLastSelectedIndex(null);
                              saveDropboxPath(folder.path || '');
                              setTimeout(() => loadDropboxFiles(), 100);
                            }}
                          >
                            <td className="px-4 py-3 whitespace-nowrap"></td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <div className="w-12 h-12 bg-gray-100 dark:bg-gray-700 rounded border border-gray-200 dark:border-gray-700 flex items-center justify-center">
                                <svg className="w-6 h-6 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                                  <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                                </svg>
                              </div>
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                              <span className="flex items-center gap-2">
                                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                                  <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                                </svg>
                                {folder.name}
                              </span>
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">—</td>
                            <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">—</td>
                          </tr>
                        ))}
                        {/* Files */}
                        {dropboxFiles.map((file, index) => {
                          const freshCredentials = getCloudCredentials();
                          const thumbnailUrl = file.path && freshCredentials.dropboxAccessToken
                            ? `/api/dropbox/get-thumbnail?token=${encodeURIComponent(freshCredentials.dropboxAccessToken)}&path=${encodeURIComponent(file.path)}`
                            : null;
                          
                          return (
                            <tr key={file.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                              <td className="px-4 py-3 whitespace-nowrap">
                                <input
                                  type="checkbox"
                                  checked={selectedCloudFiles.has(file.id)}
                                  onChange={(e) => {
                                    e.stopPropagation();
                                    e.preventDefault();
                                  }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    
                                    // Handle shift-click for range selection
                                    if (e.shiftKey && lastSelectedIndex !== null && uploadMethod === 'dropbox') {
                                      toggleFileSelection(file.id, index, true);
                                    } else {
                                      // Normal click - toggle this file
                                      toggleFileSelection(file.id, index, false);
                                    }
                                  }}
                                  className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                />
                              </td>
                              <td className="px-4 py-3 whitespace-nowrap">
                                {thumbnailUrl ? (
                                  <img
                                    src={thumbnailUrl}
                                    alt={file.name}
                                    className="w-12 h-12 object-cover rounded border border-gray-200 dark:border-gray-700 cursor-pointer hover:opacity-80 transition-opacity"
                                    onError={(e) => {
                                      // Hide broken images
                                      (e.target as HTMLImageElement).style.display = 'none';
                                    }}
                                    onClick={async () => {
                                      // Get larger preview or download link
                                      try {
                                        const freshCredentials = getCloudCredentials();
                                        if (file.path && freshCredentials.dropboxAccessToken) {
                                          // Use larger thumbnail size for preview
                                          const previewUrl = `/api/dropbox/get-thumbnail?token=${encodeURIComponent(freshCredentials.dropboxAccessToken)}&path=${encodeURIComponent(file.path)}&size=w1024h768`;
                                          setPreviewImage({ url: previewUrl, name: file.name });
                                        }
                                      } catch (err) {
                                        console.error('Failed to open preview:', err);
                                      }
                                    }}
                                  />
                                ) : (
                                  <div className="w-12 h-12 bg-gray-100 dark:bg-gray-700 rounded border border-gray-200 dark:border-gray-700 flex items-center justify-center">
                                    <svg className="w-6 h-6 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                                      <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
                                    </svg>
                                  </div>
                                )}
                              </td>
                              <td 
                                className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white cursor-pointer hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                                onClick={async () => {
                                  // Get larger preview or download link
                                  try {
                                    const freshCredentials = getCloudCredentials();
                                    if (file.path && freshCredentials.dropboxAccessToken) {
                                      // Use larger thumbnail size for preview
                                      const previewUrl = `/api/dropbox/get-thumbnail?token=${encodeURIComponent(freshCredentials.dropboxAccessToken)}&path=${encodeURIComponent(file.path)}&size=w1024h768`;
                                      setPreviewImage({ url: previewUrl, name: file.name });
                                    }
                                  } catch (err) {
                                    console.error('Failed to open preview:', err);
                                  }
                                }}
                              >
                                {file.name}
                              </td>
                              <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                                {formatFileSize(file.size)}
                              </td>
                              <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                                {file.modified ? new Date(file.modified).toLocaleDateString() : '-'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Google Drive */}
      {uploadMethod === 'googledrive' && (
        <div className="space-y-4">
          {!isGoogleDriveConnected ? (
            <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-8 text-center">
              <svg className="mx-auto h-12 w-12 text-gray-400 dark:text-gray-500 mb-4" fill="currentColor" viewBox="0 0 20 20">
                <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
              </svg>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                Connect your Google Drive account to browse and select files.
              </p>
              <button
                onClick={handleConnectGoogleDrive}
                className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 font-medium"
              >
                Connect Google Drive
              </button>
            </div>
          ) : (
            <>
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-green-600 dark:text-green-400 font-medium">✓ Connected to Google Drive</span>
                  <button
                    onClick={loadGoogleDriveFiles}
                    disabled={loadingFiles}
                    className="px-3 py-1 text-sm text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50"
                  >
                    {loadingFiles ? 'Loading...' : 'Refresh'}
                  </button>
                </div>
              </div>
              
              {loadingFiles && googleDriveFiles.length === 0 ? (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400">Loading files...</div>
              ) : googleDriveFiles.length === 0 ? (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400">No image files found. Click "Refresh" to load files.</div>
              ) : (
                <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden flex-1 min-h-0 flex flex-col">
                  <div className="flex-1 overflow-y-auto">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                      <thead className="bg-gray-50 dark:bg-gray-800 sticky top-0 z-10">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-12">
                            <input
                              type="checkbox"
                              checked={selectedCloudFiles.size === googleDriveFiles.length && googleDriveFiles.length > 0}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedCloudFiles(new Set(googleDriveFiles.map(f => f.id)));
                                } else {
                                  setSelectedCloudFiles(new Set());
                                }
                              }}
                              className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                            />
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Name</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Size</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Modified</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                        {googleDriveFiles.map((file) => (
                          <tr key={file.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                            <td className="px-4 py-3 whitespace-nowrap">
                              <input
                                type="checkbox"
                                checked={selectedCloudFiles.has(file.id)}
                                onChange={() => {
                                  const fileIndex = googleDriveFiles.findIndex(f => f.id === file.id);
                                  toggleFileSelection(file.id, fileIndex >= 0 ? fileIndex : 0);
                                }}
                                className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                              />
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                              {file.name}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                              {formatFileSize(file.size)}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                              {file.modified ? new Date(file.modified).toLocaleDateString() : '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
      </div>

      {error && (
        <div className="mt-4 p-4 text-sm text-red-800 rounded-lg bg-red-50 dark:bg-gray-800 dark:text-red-400" role="alert">
          <pre className="whitespace-pre-wrap font-sans">{error}</pre>
        </div>
      )}

      {/* Preview Modal */}
      {previewImage && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75 p-4"
          onClick={() => setPreviewImage(null)}
        >
          <div 
            className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-4xl max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white truncate flex-1 mr-4">
                {previewImage.name}
              </h3>
              <button
                onClick={() => setPreviewImage(null)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700"
                aria-label="Close preview"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            {/* Image */}
            <div className="flex-1 overflow-auto p-4 flex items-center justify-center min-h-0">
              <img
                src={previewImage.url}
                alt={previewImage.name}
                className="max-w-full max-h-[70vh] object-contain rounded"
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  target.src = '';
                  target.alt = 'Failed to load preview';
                  target.className = 'p-8 text-gray-400';
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
