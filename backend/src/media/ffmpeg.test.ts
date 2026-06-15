import { describe, it, expect } from 'vitest';
import { buildHlsCodecArgs } from './ffmpeg';

describe('buildHlsCodecArgs', () => {
  it('copies both streams for an H.264 + AAC source', () => {
    expect(buildHlsCodecArgs('h264', 'aac')).toEqual(['-c:v', 'copy', '-c:a', 'copy']);
  });

  it('copies video but re-encodes audio for H.264 + MP3', () => {
    expect(buildHlsCodecArgs('h264', 'mp3')).toEqual(['-c:v', 'copy', '-c:a', 'aac']);
  });

  it('re-encodes video but copies audio for HEVC + AAC', () => {
    expect(buildHlsCodecArgs('hevc', 'aac')).toEqual(['-c:v', 'libx264', '-c:a', 'copy']);
  });

  it('re-encodes both streams for a non-compatible source (e.g. VP9 + Opus)', () => {
    expect(buildHlsCodecArgs('vp9', 'opus')).toEqual(['-c:v', 'libx264', '-c:a', 'aac']);
  });

  it('re-encodes both when codecs are unknown/undefined (probe failed)', () => {
    expect(buildHlsCodecArgs(undefined, undefined)).toEqual(['-c:v', 'libx264', '-c:a', 'aac']);
  });

  it('re-encodes the audio when only video is known (no audio stream)', () => {
    expect(buildHlsCodecArgs('h264', undefined)).toEqual(['-c:v', 'copy', '-c:a', 'aac']);
  });

  it('is case-insensitive for codec names', () => {
    expect(buildHlsCodecArgs('H264', 'AAC')).toEqual(['-c:v', 'copy', '-c:a', 'copy']);
  });
});
