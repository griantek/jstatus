import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import { config } from '../config/config.js';

export class WhatsAppService {
  static async sendMessage(to, message) {
    try {
      await axios.post(
        `https://graph.facebook.com/v21.0/${config.whatsapp.phoneNumberId}/messages`,
        message,
        {
          headers: {
            'Authorization': `Bearer ${config.whatsapp.token}`,
            'Content-Type': 'application/json'
          }
        }
      );
    } catch (error) {
      console.error('WhatsApp message error:', error);
      throw error;
    }
  }

  static async uploadMedia(imagePath) {
    try {
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
    } catch (error) {
      console.error('Media upload error:', error);
      throw error;
    }
  }

  static async sendImage(to, imagePath, caption) {
    try {
      const mediaId = await this.uploadMedia(imagePath);
      await this.sendMessage(to, {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: to,
        type: "image",
        image: {
          id: mediaId,
          caption: caption
        }
      });
    } catch (error) {
      console.error('Send image error:', error);
      throw error;
    }
  }

  static async sendText(to, text) {
    await this.sendMessage(to, {
      messaging_product: "whatsapp",
      to: to,
      type: "text",
      text: { body: text }
    });
  }
}
