// @ts-ignore - node-fetch types are available but TypeScript can't find them
import fetch from 'node-fetch';
import { ENV } from '../util/env';
import { log, error } from '../util/logger';

const BASE = 'https://ecommerce.gelatoapis.com/v1';

export async function getTemplate(templateId: string): Promise<unknown> {
  const url = `${BASE}/templates/${encodeURIComponent(templateId)}`;
  
  log(`Fetching template: ${templateId}`);
  
  try {
    const response = await fetch(url, {
      headers: {
        'X-API-KEY': ENV.GELATO_API_KEY,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const text = await response.text();
      error(`Gelato get template failed: ${response.status} ${text}`);
      throw new Error(`Gelato API error: ${response.status} ${text}`);
    }

    const data = await response.json();
    log(`Template ${templateId} fetched successfully`);
    return data;
  } catch (err) {
    error(`Failed to fetch template ${templateId}:`, err);
    throw err;
  }
}

export async function createFromTemplate(body: unknown): Promise<unknown> {
  const storeId = ENV.GELATO_STORE_ID;
  const url = `${BASE}/stores/${encodeURIComponent(storeId)}/products:create-from-template`;
  
  log(`Creating product from template for store: ${storeId}`);
  
  // Log the payload being sent (redact tokens for security)
  const bodyForLog = JSON.parse(JSON.stringify(body));
  if (bodyForLog && typeof bodyForLog === 'object') {
    const logPayload = JSON.stringify(bodyForLog, (key, value) => {
      if (key === 'fileUrl' && typeof value === 'string') {
        // Redact token from URL for logging
        try {
          const urlObj = new URL(value);
          urlObj.searchParams.delete('t');
          return urlObj.toString() + '?t=[REDACTED]';
        } catch {
          return '[REDACTED_URL]';
        }
      }
      return value;
    }, 2);
    log(`Request payload:\n${logPayload}`);
  }
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'X-API-KEY': ENV.GELATO_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      error(`Gelato create product failed: ${response.status} ${text}`);
      throw new Error(`Gelato API error: ${response.status} ${text}`);
    }

    const data = await response.json();
    log(`Product created successfully. Response: ${JSON.stringify(data, null, 2)}`);
    return data;
  } catch (err) {
    error(`Failed to create product:`, err);
    throw err;
  }
}

export async function getProduct(productId: string): Promise<unknown> {
  const storeId = ENV.GELATO_STORE_ID;
  const url = `${BASE}/stores/${encodeURIComponent(storeId)}/products/${encodeURIComponent(productId)}`;
  
  log(`Fetching product: ${productId}`);
  
  try {
    const response = await fetch(url, {
      headers: {
        'X-API-KEY': ENV.GELATO_API_KEY,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const text = await response.text();
      error(`Gelato get product failed: ${response.status} ${text}`);
      throw new Error(`Gelato API error: ${response.status} ${text}`);
    }

    const data = await response.json();
    log(`Product ${productId} fetched successfully`);
    return data;
  } catch (err) {
    error(`Failed to fetch product ${productId}:`, err);
    throw err;
  }
}

