// ============================================================
// Transcription Service — Whisper API via OpenAI SDK
// Converts call audio recordings to text transcripts
// ============================================================

import OpenAI from 'openai';
import pino from 'pino';

const logger = pino({ name: 'transcription-service' });

let openaiClient: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not set. Cannot transcribe audio.');
    }
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

/**
 * Transcribes an audio buffer using OpenAI's Whisper API.
 * Accepts any audio format supported by Whisper (mp3, mp4, mpeg, mpga, m4a, wav, webm).
 *
 * @param audioBuffer - The raw audio data as a Buffer
 * @param filename - Optional filename with extension (defaults to 'recording.webm')
 * @returns The transcript text
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  filename?: string
): Promise<string> {
  const resolvedFilename = filename || 'recording.webm';
  const startTime = Date.now();

  logger.info(
    { filename: resolvedFilename, sizeBytes: audioBuffer.length },
    'Starting audio transcription'
  );

  try {
    // Convert Buffer to a File object for the OpenAI SDK
    // Use toJSON() to get a plain array that satisfies BlobPart
    const file = new File(
      [new Blob([new Uint8Array(audioBuffer)])],
      resolvedFilename,
      { type: getMimeType(resolvedFilename) }
    );

    const response = await getOpenAI().audio.transcriptions.create({
      model: 'whisper-1',
      file,
    });

    const durationMs = Date.now() - startTime;
    logger.info(
      {
        filename: resolvedFilename,
        durationMs,
        transcriptLength: response.text.length,
      },
      'Transcription completed successfully'
    );

    return response.text;
  } catch (error) {
    const durationMs = Date.now() - startTime;
    logger.error(
      {
        filename: resolvedFilename,
        durationMs,
        error: error instanceof Error ? error.message : String(error),
      },
      'Transcription failed'
    );
    throw error;
  }
}

/**
 * Returns the MIME type for a given audio filename.
 */
function getMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    mp3: 'audio/mpeg',
    mp4: 'audio/mp4',
    mpeg: 'audio/mpeg',
    mpga: 'audio/mpeg',
    m4a: 'audio/m4a',
    wav: 'audio/wav',
    webm: 'audio/webm',
    ogg: 'audio/ogg',
  };
  return mimeTypes[ext || ''] || 'audio/webm';
}
