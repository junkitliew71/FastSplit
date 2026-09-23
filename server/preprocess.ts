import sharp from 'sharp';
import type { ImageQuality } from './types.js';

export type PreparedServerImage = {
  firstPass: Buffer;
  createSecondPass: () => Promise<{ image: Buffer; width: number; height: number; offsetX: number; offsetY: number }>;
  width: number;
  height: number;
  format: string | null;
  quality: ImageQuality;
};

const SERVER_MAX_LONG_SIDE = 2200;
const SERVER_MIN_OCR_LONG_SIDE = 1800;

export async function preprocessImage(input: Buffer): Promise<PreparedServerImage> {
  const base = sharp(input, { failOn: 'error', limitInputPixels: 40_000_000 }).rotate();
  const metadata = await base.metadata();
  if (!metadata.width || !metadata.height) throw new Error('Image dimensions could not be read.');

  const resized = resizeToLimit(base.clone(), metadata.width, metadata.height);
  const firstPass = await resized.clone().jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toBuffer();
  const stats = await sharp(firstPass).stats();
  const channels = stats.channels.slice(0, 3);
  const brightness = channels.reduce((sum, channel) => sum + channel.mean, 0) / channels.length / 255;
  const contrast = channels.reduce((sum, channel) => sum + channel.stdev, 0) / channels.length / 128;
  const quality: ImageQuality = {
    brightness: round(brightness),
    contrast: round(contrast),
    lowContrast: contrast < 0.22,
    underexposed: brightness < 0.28,
    overexposed: brightness > 0.92,
  };

  const normalizedMetadata = await sharp(firstPass).metadata();
  return {
    firstPass,
    createSecondPass: () => enhancedPass(firstPass, quality, normalizedMetadata.width ?? metadata.width, normalizedMetadata.height ?? metadata.height),
    width: normalizedMetadata.width ?? metadata.width,
    height: normalizedMetadata.height ?? metadata.height,
    format: metadata.format ?? null,
    quality,
  };
}

function resizeToLimit(image: sharp.Sharp, width: number, height: number): sharp.Sharp {
  const longSide = Math.max(width, height);
  if (longSide < SERVER_MIN_OCR_LONG_SIDE) {
    return image.resize({
      width: width >= height ? SERVER_MIN_OCR_LONG_SIDE : undefined,
      height: height > width ? SERVER_MIN_OCR_LONG_SIDE : undefined,
      fit: 'inside',
      kernel: sharp.kernel.lanczos3,
    }).sharpen({ sigma: 0.7, m1: 0.5, m2: 1 });
  }
  if (longSide <= SERVER_MAX_LONG_SIDE) return image;
  return image.resize({
    width: width >= height ? SERVER_MAX_LONG_SIDE : undefined,
    height: height > width ? SERVER_MAX_LONG_SIDE : undefined,
    fit: 'inside',
    withoutEnlargement: true,
  });
}

async function enhancedPass(input: Buffer, quality: ImageQuality, width: number, height: number): Promise<{ image: Buffer; width: number; height: number; offsetX: number; offsetY: number }> {
  const backgroundPhoto = quality.contrast > 0.45 && quality.brightness < 0.7;
  const offsetX = backgroundPhoto ? Math.round(width * 0.05) : 0;
  const offsetY = backgroundPhoto ? Math.round(height * 0.14) : 0;
  const passWidth = backgroundPhoto ? Math.round(width * 0.9) : width;
  const passHeight = backgroundPhoto ? Math.round(height * 0.82) : height;
  let pipeline = sharp(input);
  if (backgroundPhoto) pipeline = pipeline.extract({ left: offsetX, top: offsetY, width: passWidth, height: passHeight });
  // Adapt the reference pipeline's light denoise + local contrast approach to
  // Tesseract: keep gradients on clear receipts and only enhance noisy paper.
  pipeline = pipeline.greyscale();
  if (quality.lowContrast || quality.underexposed || quality.overexposed) {
    pipeline = pipeline.clahe({ width: 8, height: 8, maxSlope: 3 }).normalize({ lower: 2, upper: 98 });
  }
  const image = await pipeline.sharpen({ sigma: 0.9, m1: 0.7, m2: 1.4 }).jpeg({ quality: 96 }).toBuffer();
  return { image, width: passWidth, height: passHeight, offsetX, offsetY };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
