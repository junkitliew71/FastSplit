import sharp from 'sharp';
import type { ImageQuality } from './types.js';

export type PreparedServerImage = {
  firstPass: Buffer;
  createSecondPass: () => Promise<Buffer>;
  width: number;
  height: number;
  format: string | null;
  quality: ImageQuality;
};

const SERVER_MAX_LONG_SIDE = 2200;

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
    createSecondPass: () => enhancedPass(firstPass, quality),
    width: normalizedMetadata.width ?? metadata.width,
    height: normalizedMetadata.height ?? metadata.height,
    format: metadata.format ?? null,
    quality,
  };
}

function resizeToLimit(image: sharp.Sharp, width: number, height: number): sharp.Sharp {
  if (Math.max(width, height) <= SERVER_MAX_LONG_SIDE) return image;
  return image.resize({
    width: width >= height ? SERVER_MAX_LONG_SIDE : undefined,
    height: height > width ? SERVER_MAX_LONG_SIDE : undefined,
    fit: 'inside',
    withoutEnlargement: true,
  });
}

async function enhancedPass(input: Buffer, quality: ImageQuality): Promise<Buffer> {
  let pipeline = sharp(input).greyscale();
  if (quality.lowContrast || quality.underexposed || quality.overexposed) {
    pipeline = pipeline.normalize({ lower: 2, upper: 98 });
  }
  return pipeline.sharpen({ sigma: 1, m1: 0.8, m2: 1.6 }).jpeg({ quality: 94 }).toBuffer();
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
