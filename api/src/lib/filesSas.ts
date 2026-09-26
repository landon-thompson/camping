import {
  BlobSASPermissions,
  BlobServiceClient,
  SASProtocol,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
} from '@azure/storage-blob';
import { containerName, requireConnectionString } from './filesConfig';

/** Kept short: these are single-use links for one upload or one image load. */
export const UPLOAD_SAS_MINUTES = 15;
export const READ_SAS_MINUTES = 15;
/** Small backward allowance so the SAS is already valid the instant it's issued
 * even if the Function host's clock is a little ahead of the storage service. */
const CLOCK_SKEW_MS = 5 * 60_000;

export interface SasResult {
  url: string;
  expiresOn: string;
}

// Reuse the client across invocations of the same warm Function instance.
let cachedClient: BlobServiceClient | null = null;
let cachedConnStr: string | null = null;

function blobService(): BlobServiceClient {
  const cs = requireConnectionString();
  if (!cachedClient || cachedConnStr !== cs) {
    cachedClient = BlobServiceClient.fromConnectionString(cs);
    cachedConnStr = cs;
  }
  return cachedClient;
}

function sharedKeyCredentialOf(client: BlobServiceClient): StorageSharedKeyCredential {
  const cred = client.credential;
  if (!(cred instanceof StorageSharedKeyCredential)) {
    throw new Error('STORAGE_CONNECTION_STRING must be an account-key connection string (SAS signing needs the account key).');
  }
  return cred;
}

/**
 * Sign one blob URL. Pulled out of uploadUrlFor/readUrlFor so tests can call it
 * directly with a fake credential — generateBlobSASQueryParameters is pure
 * HMAC-SHA256 signing and never touches the network.
 */
export function signBlobUrl(
  credential: StorageSharedKeyCredential,
  container: string,
  blobPath: string,
  blobUrl: string,
  permissions: string,
  minutes: number,
  now = new Date(),
): SasResult {
  const startsOn = new Date(now.getTime() - CLOCK_SKEW_MS);
  const expiresOn = new Date(now.getTime() + minutes * 60_000);
  const qp = generateBlobSASQueryParameters(
    {
      containerName: container,
      blobName: blobPath,
      permissions: BlobSASPermissions.parse(permissions),
      protocol: SASProtocol.Https,
      startsOn,
      expiresOn,
    },
    credential,
  );
  return { url: `${blobUrl}?${qp.toString()}`, expiresOn: expiresOn.toISOString() };
}

/** Write-only (create + write), ~15 min: enough for one PUT of one photo. */
export function uploadUrlFor(blobPath: string): SasResult {
  const client = blobService();
  const container = containerName();
  const blockBlob = client.getContainerClient(container).getBlockBlobClient(blobPath);
  return signBlobUrl(sharedKeyCredentialOf(client), container, blobPath, blockBlob.url, 'cw', UPLOAD_SAS_MINUTES);
}

/** Read-only, ~15 min: enough to load one image into the app. */
export function readUrlFor(blobPath: string): SasResult {
  const client = blobService();
  const container = containerName();
  const blockBlob = client.getContainerClient(container).getBlockBlobClient(blobPath);
  return signBlobUrl(sharedKeyCredentialOf(client), container, blobPath, blockBlob.url, 'r', READ_SAS_MINUTES);
}
