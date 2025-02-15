import FormData from 'form-data';
import fs from 'fs';
import { config } from '../config/config.js';
import axios from 'axios';

export class MediaService {
  static async uploadToWhatsApp(imagePath) {
    const formData = new FormData();
    formData.append('file', fs.createReadStream(imagePath));
    formData.append('messaging_product', 'whatsapp');

    const response = await axios.post(
      `https://graph.facebook.com/v21.0/${config.whatsapp.phoneNumberId}/media`,
      formData,
      {
        headers: {
          ...formData.getHeaders(),
          'Authorization': `Bearer ${config.whatsapp.token}`
        }
      }
    );

    return response.data.id;
  }

  static async deleteMedia(mediaId) {
    try {
      await axios.delete(
        `https://graph.facebook.com/v21.0/${mediaId}`,
        {
          headers: {
            'Authorization': `Bearer ${config.whatsapp.token}`
          }
        }
      );
    } catch (error) {
      console.error('Error deleting media:', error);
    }
  }

  static async cleanupTempFiles(folderPath, maxAge = 30 * 60 * 1000) {
    try {
      if (!fs.existsSync(folderPath)) return;

      const now = Date.now();
      const files = fs.readdirSync(folderPath);

      for (const file of files) {
        const filePath = path.join(folderPath, file);
        const stats = fs.statSync(filePath);

        if (now - stats.mtime.getTime() > maxAge) {
          fs.unlinkSync(filePath);
        }
      }
    } catch (error) {
      console.error('Error cleaning up temp files:', error);
    }
  }
}
