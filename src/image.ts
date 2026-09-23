export type PreparedImage = {
  blob: Blob;
  previewUrl: string;
  originalBytes: number;
  uploadedBytes: number;
  width: number;
  height: number;
};

const MAX_LONG_SIDE = 2000;
const JPEG_QUALITY = 0.86;

export async function prepareReceiptImage(file: File): Promise<PreparedImage> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose an image file.');
  }

  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, MAX_LONG_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Image processing is not available in this browser.');

  context.fillStyle = '#fff';
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => result ? resolve(result) : reject(new Error('Could not prepare the receipt image.')),
      'image/jpeg',
      JPEG_QUALITY,
    );
  });

  return {
    blob,
    previewUrl: URL.createObjectURL(blob),
    originalBytes: file.size,
    uploadedBytes: blob.size,
    width,
    height,
  };
}
