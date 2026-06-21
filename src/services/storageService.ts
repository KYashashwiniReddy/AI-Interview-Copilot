import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

export class StorageService {
  private supabase: SupabaseClient | null = null;
  private isLocalFallback = true;
  private uploadDir = path.join(__dirname, '../../uploads');

  constructor() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_KEY;

    if (url && key) {
      try {
        this.supabase = createClient(url, key);
        this.isLocalFallback = false;
        console.log('Supabase Storage service initialized successfully.');
      } catch (err) {
        console.error('Failed to initialize Supabase Storage client, falling back to local storage:', err);
      }
    } else {
      console.log('Supabase environment variables missing. Operating in local storage mode.');
    }

    // Ensure local upload directories exist
    if (this.isLocalFallback) {
      if (!fs.existsSync(this.uploadDir)) {
        fs.mkdirSync(this.uploadDir, { recursive: true });
      }
    }
  }

  /**
   * Upload file buffer to storage
   * @returns Public URL of the uploaded asset
   */
  async uploadFile(
    bucket: string,
    fileName: string,
    buffer: Buffer,
    mimetype: string
  ): Promise<string> {
    if (!this.isLocalFallback && this.supabase) {
      try {
        const { data, error } = await this.supabase.storage
          .from(bucket)
          .upload(fileName, buffer, {
            contentType: mimetype,
            upsert: true
          });

        if (error) throw error;

        // Get public URL
        const { data: publicUrlData } = this.supabase.storage
          .from(bucket)
          .getPublicUrl(fileName);

        return publicUrlData.publicUrl;
      } catch (err: any) {
        console.error(`Supabase upload failed for ${bucket}/${fileName}:`, err);
        // Fallback to local on upload error
      }
    }

    // Local filesystem storage fallback
    try {
      const bucketDir = path.join(this.uploadDir, bucket);
      if (!fs.existsSync(bucketDir)) {
        fs.mkdirSync(bucketDir, { recursive: true });
      }

      const filePath = path.join(bucketDir, fileName);
      fs.writeFileSync(filePath, buffer);
      
      // Return local server asset URL pathway
      return `http://localhost:${process.env.PORT || 8000}/uploads/${bucket}/${fileName}`;
    } catch (err: any) {
      console.error(`Local file write failed for ${bucket}/${fileName}:`, err);
      throw new Error(`Failed to store uploaded asset: ${err.message}`);
    }
  }

  /**
   * Delete file from storage
   */
  async deleteFile(bucket: string, fileName: string): Promise<void> {
    if (!this.isLocalFallback && this.supabase) {
      try {
        await this.supabase.storage.from(bucket).remove([fileName]);
        return;
      } catch (err) {
        console.error('Failed to delete file from Supabase:', err);
      }
    }

    // Local delete
    try {
      const filePath = path.join(this.uploadDir, bucket, fileName);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (err) {
      console.error('Failed to delete local file:', err);
    }
  }
}
