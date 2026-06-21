import pdf from 'pdf-parse';
import mammoth from 'mammoth';

export class ParserService {
  /**
   * Parses PDF file buffer to extract raw text and page count
   */
  async parsePDF(buffer: Buffer): Promise<{ text: string; pageCount: number }> {
    try {
      const data = await pdf(buffer);
      if (!data || !data.text) {
        throw new Error('PDF parsed text is empty');
      }
      return { text: data.text, pageCount: data.numpages || 1 };
    } catch (error: any) {
      console.error('PDF parsing error:', error);
      throw new Error(`Failed to parse PDF resume: ${error.message}`);
    }
  }

  /**
   * Parses DOCX file buffer to extract raw text and page count
   */
  async parseDOCX(buffer: Buffer): Promise<{ text: string; pageCount: number }> {
    try {
      const result = await mammoth.extractRawText({ buffer });
      if (!result || !result.value) {
        throw new Error('DOCX parsed text is empty');
      }
      const text = result.value;
      // Estimate page count for DOCX:
      // A standard resume page typically has 400-500 words. We'll count words:
      const wordsCount = text.trim().split(/\s+/).filter((w: string) => w.length > 0).length;
      const pageCount = Math.max(1, Math.ceil(wordsCount / 500));
      return { text, pageCount };
    } catch (error: any) {
      console.error('DOCX parsing error:', error);
      throw new Error(`Failed to parse DOCX resume: ${error.message}`);
    }
  }

  /**
   * General parse selector based on file mimetype
   */
  async parseResume(buffer: Buffer, mimetype: string): Promise<{ text: string; pageCount: number }> {
    if (mimetype === 'application/pdf') {
      return this.parsePDF(buffer);
    } else if (
      mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      mimetype === 'application/msword'
    ) {
      return this.parseDOCX(buffer);
    } else {
      // Fallback: assume plain text
      const rawText = buffer.toString('utf-8');
      if (rawText.trim().length > 0) {
        const wordsCount = rawText.trim().split(/\s+/).filter((w: string) => w.length > 0).length;
        const pageCount = Math.max(1, Math.ceil(wordsCount / 500));
        return { text: rawText, pageCount };
      }
      throw new Error(`Unsupported file type: ${mimetype}. Please upload a PDF or DOCX file.`);
    }
  }
}
