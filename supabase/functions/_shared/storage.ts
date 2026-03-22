export const TRANSACTION_IMAGE_BUCKET = "transaction-images";

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};

export function mimeTypeToExtension(mimeType: string): string {
  return EXTENSION_BY_MIME[mimeType] ?? "jpg";
}

export function buildTransactionImagePath(
  operatorId: string,
  mimeType: string,
  uniqueId = crypto.randomUUID()
): string {
  return `${operatorId}/${uniqueId}.${mimeTypeToExtension(mimeType)}`;
}

