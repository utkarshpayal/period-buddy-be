import { PDFDocument } from 'pdf-lib';

/** Pages in an uploaded file: a PDF's page count, 1 for an image, or null
 * when a PDF can't be read (then no page limit is applied to it). */
export const countPages = async (buffer, mimeType) => {
  if (mimeType !== 'application/pdf') return 1;
  try {
    const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false });
    return pdf.getPageCount();
  } catch {
    return null;
  }
};

/** Whether a document with `pages` fits under `maxPages` (null = no limit). */
export const withinPageLimit = (pages, maxPages) =>
  maxPages == null || pages == null || pages <= maxPages;
