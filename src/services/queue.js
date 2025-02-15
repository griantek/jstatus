export class RequestQueue {
  static queue = new Map();
  static processing = new Map();
  
  static async add(userId, request) {
    if (!this.queue.has(userId)) {
      this.queue.set(userId, []);
      this.processing.set(userId, false);
    }
    
    const userQueue = this.queue.get(userId);
    userQueue.push(request);
    
    if (!this.processing.get(userId)) {
      await this.processQueue(userId);
    }
  }
  
  static async processQueue(userId) {
    if (this.processing.get(userId)) return;
    
    this.processing.set(userId, true);
    const userQueue = this.queue.get(userId);
    
    while (userQueue.length > 0) {
      const request = userQueue.shift();
      try {
        await request();
      } catch (error) {
        console.error(`Error processing request for user ${userId}:`, error);
      }
    }
    
    this.processing.set(userId, false);
  }

  static clearQueue(userId) {
    if (this.queue.has(userId)) {
      this.queue.get(userId).length = 0;
    }
  }

  static getQueueLength(userId) {
    return this.queue.has(userId) ? this.queue.get(userId).length : 0;
  }

  static isProcessing(userId) {
    return this.processing.get(userId) || false;
  }
}
