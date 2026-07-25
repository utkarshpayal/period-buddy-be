import { sendResponse, sendError } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { SUPPORTED_LANGUAGES, speechToText, textToSpeech } from '../utils/sarvamClient.js';
import logger from '../utils/logger.js';

export const getLanguages = async (req, res) => sendResponse(res, HTTP_STATUS.OK, 'Languages fetched', { languages: SUPPORTED_LANGUAGES });

export const transcribeAudio = async (req, res, next) => {
  try {
    if (!req.file) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'No audio file was uploaded');
    }

    const { languageCode, mode } = req.body;

    const result = await speechToText({
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
      filename: req.file.originalname,
      languageCode: languageCode || undefined,
      mode: mode || 'transcribe',
    });

    return sendResponse(res, HTTP_STATUS.OK, 'Audio transcribed', result);
  } catch (error) {
    logger.error('speech_transcribe_error', { userId: req.userId, error: error.message });
    next(error);
  }
};

export const synthesizeSpeech = async (req, res, next) => {
  try {
    const { text, languageCode, speaker, pace } = req.body;
    if (!text || !text.trim()) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Text is required');
    }

    const result = await textToSpeech({
      text,
      targetLanguageCode: languageCode || 'en-IN',
      speaker: speaker || undefined,
      pace: pace ? Number(pace) : undefined,
    });

    return sendResponse(res, HTTP_STATUS.OK, 'Speech generated', result);
  } catch (error) {
    logger.error('speech_synthesize_error', { userId: req.userId, error: error.message });
    next(error);
  }
};
