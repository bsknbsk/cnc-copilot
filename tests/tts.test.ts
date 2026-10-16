import { describe, it, expect } from 'vitest';
import { wrapPcmToWav } from '../server/routes/tts.js';

describe('Gemini TTS Audio Packaging', () => {
  it('wraps raw PCM buffer into a valid 44-byte RIFF WAV header', () => {
    // 48000 bytes corresponds to 1 second of 24000Hz 16-bit mono PCM (24000 samples * 2 bytes)
    const pcmData = Buffer.alloc(48000, 0x12);
    const wav = wrapPcmToWav(pcmData, 24000, 1, 16);

    expect(wav.length).toBe(44 + 48000);

    // RIFF chunk descriptor
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.readUInt32LE(4)).toBe(36 + 48000);
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');

    // fmt subchunk
    expect(wav.toString('ascii', 12, 16)).toBe('fmt ');
    expect(wav.readUInt32LE(16)).toBe(16); // subchunk1 size for PCM
    expect(wav.readUInt16LE(20)).toBe(1);  // AudioFormat = 1 (PCM)
    expect(wav.readUInt16LE(22)).toBe(1);  // NumChannels = 1
    expect(wav.readUInt32LE(24)).toBe(24000); // SampleRate
    expect(wav.readUInt32LE(28)).toBe(48000); // ByteRate = 24000 * 1 * 16 / 8
    expect(wav.readUInt16LE(32)).toBe(2);  // BlockAlign = 1 * 16 / 8
    expect(wav.readUInt16LE(34)).toBe(16); // BitsPerSample = 16

    // data subchunk
    expect(wav.toString('ascii', 36, 40)).toBe('data');
    expect(wav.readUInt32LE(40)).toBe(48000);
    expect(wav.subarray(44).equals(pcmData)).toBe(true);
  });

  it('handles empty PCM buffer correctly', () => {
    const emptyPcm = Buffer.alloc(0);
    const wav = wrapPcmToWav(emptyPcm, 24000, 1, 16);

    expect(wav.length).toBe(44);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.readUInt32LE(4)).toBe(36);
    expect(wav.readUInt32LE(40)).toBe(0);
  });
});
