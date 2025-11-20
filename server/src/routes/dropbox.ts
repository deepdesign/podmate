import { Router } from 'express';
import axios from 'axios';
import { ENV } from '../util/env';
import { log, error as errorLog } from '../util/logger';

const router = Router();

// OAuth 2.0 flow for Dropbox
// We need CLIENT_ID (App Key) and CLIENT_SECRET (App Secret)
// Users authenticate with their own Dropbox accounts

// Step 1: Initiate OAuth - redirect user to Dropbox
router.get('/auth', (req, res) => {
  const clientId = ENV.DROPBOX_APP_KEY; // This is the Client ID
  const redirectUri = `${req.protocol}://${req.get('host')}/api/dropbox/callback`;
  const state = req.query.state as string || 'default'; // Optional: pass state for security
  
  if (!clientId) {
    errorLog('Dropbox OAuth initiated but DROPBOX_APP_KEY is not set in .env');
    return res.status(500).json({ 
      error: 'Dropbox Client ID not configured. Please ensure DROPBOX_APP_KEY is set in your .env file and restart the server.' 
    });
  }

  // Request minimal scopes needed: read files and metadata (no write access needed)
  const scope = 'files.content.read files.metadata.read';
  
  // Log the redirect URI for debugging
  log(`Dropbox OAuth - Redirect URI: ${redirectUri}`);
  log(`Dropbox OAuth - Make sure this EXACT URI is in Dropbox App Settings > OAuth 2 > Redirect URIs`);
  log(`Dropbox OAuth - Scope: ${scope}`);
  log(`Dropbox OAuth - Client ID: ${clientId.substring(0, 8)}...`);
  log(`Dropbox OAuth - IMPORTANT: Make sure your app is "Full Dropbox" (not "App Folder") to browse entire Dropbox`);
  
  const authUrl = `https://www.dropbox.com/oauth2/authorize?` +
    `client_id=${encodeURIComponent(clientId)}&` +
    `redirect_uri=${encodeURIComponent(redirectUri)}&` +
    `response_type=code&` +
    `token_access_type=offline&` + // Request refresh token
    `scope=${encodeURIComponent(scope)}&` + // Read-only permissions
    (state ? `&state=${encodeURIComponent(state)}` : '');

  log(`Initiating Dropbox OAuth flow. Redirecting to: ${authUrl.replace(clientId, '[REDACTED]').replace(redirectUri, '[REDIRECT_URI]')}`);
  res.redirect(authUrl);
});

// Step 2: Handle OAuth callback - exchange code for access token
router.get('/callback', async (req, res) => {
  const code = req.query.code as string;
  const error = req.query.error as string;
  const state = req.query.state as string;

  if (error) {
    errorLog(`Dropbox OAuth error: ${error}`);
    // Redirect back to client with error
    const clientUrl = ENV.CLIENT_URL || 'http://localhost:5173';
    return res.redirect(`${clientUrl}/?dropbox_auth_error=${encodeURIComponent(error)}`);
  }

  if (!code) {
    errorLog('Dropbox OAuth callback missing authorization code');
    const clientUrl = ENV.CLIENT_URL || 'http://localhost:5173';
    return res.redirect(`${clientUrl}/?dropbox_auth_error=missing_code`);
  }

  try {
    const clientId = ENV.DROPBOX_APP_KEY;
    const clientSecret = ENV.DROPBOX_APP_SECRET; // We'll need to add this to env
    const redirectUri = `${req.protocol}://${req.get('host')}/api/dropbox/callback`;

    if (!clientId || !clientSecret) {
      errorLog('Dropbox OAuth credentials not configured');
      const clientUrl = ENV.CLIENT_URL || 'http://localhost:5173';
      return res.redirect(`${clientUrl}/?dropbox_auth_error=not_configured`);
    }

    // Exchange authorization code for access token
    const tokenResponse = await axios.post(
      'https://api.dropboxapi.com/oauth2/token',
      new URLSearchParams({
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
      {
        auth: {
          username: clientId,
          password: clientSecret,
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    const { access_token, refresh_token, expires_in } = tokenResponse.data;

    log('Dropbox OAuth successful - token obtained');

    // Redirect back to client with tokens (in production, use secure session storage)
    // For now, pass tokens as query params (not ideal, but works for development)
    // In production, store in secure HTTP-only cookies or session
    const clientUrl = ENV.CLIENT_URL || 'http://localhost:5173';
    const params = new URLSearchParams({
      dropbox_auth_success: 'true',
      access_token,
      expires_in: expires_in?.toString() || '14400',
      step: '2', // Navigate to Upload artwork screen
      tab: 'dropbox', // Pre-select Dropbox tab
    });
    
    if (refresh_token) {
      params.append('refresh_token', refresh_token);
    }

    res.redirect(`${clientUrl}/?${params.toString()}`);
  } catch (err) {
    errorLog(`Dropbox OAuth token exchange failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    const clientUrl = ENV.CLIENT_URL || 'http://localhost:5173';
    res.redirect(`${clientUrl}/?dropbox_auth_error=token_exchange_failed`);
  }
});

// Step 3: List files in Dropbox using access token
router.post('/list-files', async (req, res) => {
  try {
    const { accessToken, path = '' } = req.body;

    if (!accessToken) {
      return res.status(400).json({ error: 'Access token required' });
    }

    const listPath = path || '';
    log(`Listing Dropbox files from path: "${listPath}"`);
    
    // Collect all entries across all pages (Dropbox paginates results)
    let allEntries: any[] = [];
    let cursor: string | undefined = undefined;
    let hasMore = true;
    
    while (hasMore) {
      const response: { data: { entries?: any[]; has_more?: boolean; cursor?: string } } = await axios.post(
        cursor 
          ? 'https://api.dropboxapi.com/2/files/list_folder/continue'
          : 'https://api.dropboxapi.com/2/files/list_folder',
        cursor ? { cursor } : {
          path: listPath,
          recursive: false,
        },
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );
      
      const entries = response.data.entries || [];
      allEntries = allEntries.concat(entries);
      hasMore = response.data.has_more || false;
      cursor = response.data.cursor;
      
      log(`Fetched ${entries.length} entries (total: ${allEntries.length}, has_more: ${hasMore})`);
    }
    
    log(`Dropbox API returned ${allEntries.length} total entries after pagination`);
    
    // Separate folders and files
    const folders = allEntries
      .filter((entry: any) => entry['.tag'] === 'folder')
      .map((entry: any) => ({
        id: entry.id,
        name: entry.name,
        path: entry.path_lower || entry.path_display,
        type: 'folder' as const,
      }));
    
    // Filter to only image files
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff'];
    const files = allEntries
      .filter((entry: any) => entry['.tag'] === 'file')
      .filter((entry: any) => {
        const name = entry.name.toLowerCase();
        return imageExtensions.some(ext => name.endsWith(ext));
      })
      .map((entry: any) => ({
        id: entry.id,
        name: entry.name,
        path: entry.path_lower || entry.path_display,
        size: entry.size,
        modified: entry.client_modified || entry.server_modified,
        type: 'file' as const,
      }));

    log(`Found ${folders.length} folders and ${files.length} image files`);
    if (allEntries.length > 0 && files.length === 0 && folders.length === 0) {
      const fileNames = allEntries
        .filter((e: any) => e['.tag'] === 'file')
        .map((e: any) => e.name)
        .slice(0, 5);
      log(`Found ${allEntries.filter((e: any) => e['.tag'] === 'file').length} files but none are images. Sample file names: ${fileNames.join(', ')}`);
    }

    res.json({ folders, files });
  } catch (err) {
    errorLog(`Failed to list Dropbox files: ${err instanceof Error ? err.message : 'Unknown error'}`);
    if (axios.isAxiosError(err) && err.response) {
      return res.status(err.response.status).json({ 
        error: err.response.data?.error_summary || 'Failed to list Dropbox files' 
      });
    }
    res.status(500).json({ error: 'Failed to list Dropbox files' });
  }
});

// Step 4: Get download link for a specific file
router.post('/get-download-link', async (req, res) => {
  try {
    const { accessToken, path } = req.body;

    if (!accessToken || !path) {
      return res.status(400).json({ error: 'Access token and path required' });
    }

    // Get temporary download link
    const response = await axios.post(
      'https://api.dropboxapi.com/2/files/get_temporary_link',
      { path },
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    res.json({ 
      link: response.data.link,
      expires: response.data.expires,
    });
  } catch (err) {
    errorLog(`Failed to get Dropbox download link: ${err instanceof Error ? err.message : 'Unknown error'}`);
    if (axios.isAxiosError(err) && err.response) {
      return res.status(err.response.status).json({ 
        error: err.response.data?.error_summary || 'Failed to get download link' 
      });
    }
    res.status(500).json({ error: 'Failed to get download link' });
  }
});

// Step 5: Get thumbnail for an image file (GET endpoint for easy img src)
router.get('/get-thumbnail', async (req, res) => {
  try {
    const accessToken = req.query.token as string;
    let path = req.query.path as string;

    if (!accessToken || !path) {
      return res.status(400).json({ error: 'Access token and path required' });
    }

    // Decode the path in case it was URL encoded
    path = decodeURIComponent(path);

    // Dropbox API requires paths to start with "/" for root-level files
    // Normalize the path to ensure it starts with "/"
    if (!path.startsWith('/')) {
      path = '/' + path;
    }

    // Get size parameter from query string, default to w128h128 for thumbnails
    // Valid sizes: w32h32, w64h64, w128h128, w640h480, w1024h768
    const sizeParam = (req.query.size as string) || 'w128h128';
    const validSizes = ['w32h32', 'w64h64', 'w128h128', 'w640h480', 'w1024h768'];
    const thumbnailSize = validSizes.includes(sizeParam) ? sizeParam : 'w128h128';

    // Dropbox API expects the path parameter in Dropbox-API-Arg header
    // Format: { "path": "/path/to/file", "size": "w128h128", "format": "jpeg" }
    // Note: Only supports .jpg, .jpeg, .png, .tiff, .tif, .gif, .bmp
    // Files larger than 20MB are not eligible for thumbnails
    const apiArg = {
      path: path,
      size: thumbnailSize,
      format: 'jpeg',
    };

    log(`Getting Dropbox thumbnail for path: "${path}" (normalized from original: "${req.query.path}")`);

    // Get thumbnail from Dropbox (returns image/jpeg)
    // Dropbox content API requires Content-Type to be "text/plain" or omitted
    // Axios defaults to "application/x-www-form-urlencoded" which Dropbox rejects
    const response = await axios.post(
      'https://content.dropboxapi.com/2/files/get_thumbnail',
      null, // No body, all params in header
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Dropbox-API-Arg': JSON.stringify(apiArg),
          'Content-Type': 'text/plain', // Required by Dropbox content API
        },
        responseType: 'arraybuffer',
        validateStatus: (status) => status < 500, // Don't throw on 4xx errors
      }
    );

    // Check if request was successful
    if (response.status !== 200) {
      // Try to parse error response - might be JSON or binary
      let errorMsg = `Status ${response.status}`;
      try {
        const errorText = Buffer.from(response.data).toString('utf-8');
        const errorJson = JSON.parse(errorText);
        errorMsg += `: ${JSON.stringify(errorJson)}`;
      } catch {
        errorMsg += `: ${Buffer.from(response.data).toString('utf-8').substring(0, 200)}`;
      }
      throw new Error(errorMsg);
    }

    // Set appropriate headers and return the image
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(Buffer.from(response.data));
  } catch (err) {
    let errorDetails = '';
    if (axios.isAxiosError(err) && err.response) {
      try {
        // Try to parse error response
        const errorText = Buffer.from(err.response.data).toString('utf-8');
        const errorJson = JSON.parse(errorText);
        errorDetails = `Status ${err.response.status}: ${JSON.stringify(errorJson)}`;
      } catch {
        errorDetails = `Status ${err.response.status}: ${Buffer.from(err.response.data).toString('utf-8').substring(0, 200)}`;
      }
    } else {
      errorDetails = err instanceof Error ? err.message : 'Unknown error';
    }
    errorLog(`Failed to get Dropbox thumbnail for path "${req.query.path}": ${errorDetails}`);
    
    // Return a 1x1 transparent pixel instead of error to avoid broken images
    const transparentPixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
    res.setHeader('Content-Type', 'image/gif');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(transparentPixel);
  }
});

// Step 6: Refresh access token using refresh token
router.post('/refresh-token', async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token required' });
    }

    const clientId = ENV.DROPBOX_APP_KEY;
    const clientSecret = ENV.DROPBOX_APP_SECRET;

    if (!clientId || !clientSecret) {
      errorLog('Dropbox OAuth credentials not configured for token refresh');
      return res.status(500).json({ error: 'Dropbox credentials not configured' });
    }

    // Exchange refresh token for new access token
    const tokenResponse = await axios.post(
      'https://api.dropboxapi.com/oauth2/token',
      new URLSearchParams({
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
      {
        auth: {
          username: clientId,
          password: clientSecret,
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    const { access_token, expires_in } = tokenResponse.data;
    const expiryTime = Date.now() + (expires_in * 1000);

    log('Dropbox token refreshed successfully');

    res.json({
      access_token,
      expires_in,
      expiryTime,
    });
  } catch (err) {
    errorLog(`Failed to refresh Dropbox token: ${err instanceof Error ? err.message : 'Unknown error'}`);
    if (axios.isAxiosError(err) && err.response) {
      return res.status(err.response.status).json({ 
        error: err.response.data?.error_summary || 'Failed to refresh token' 
      });
    }
    res.status(500).json({ error: 'Failed to refresh token' });
  }
});

export default router;

