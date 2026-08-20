import { env } from '@/lib/env';

export function getVendorBaseUrl() {
  return process.env.VENDOR_API_BASE_URL || env.VENDOR_API_BASE_URL;
}

export function getVendorMode() {
  return process.env.VENDOR_API_BASE_URL?.includes('uat') ? 'UAT' : 'PROD';
}

export function buildVendorEndpoint() {
  const base = getVendorBaseUrl();
  return `${base.replace(/\/$/, '')}/messages`;
}
