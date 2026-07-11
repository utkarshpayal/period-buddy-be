import mongoose from 'mongoose';
import logger from '../utils/logger.js';

export const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    logger.info('mongodb_connected', { action: 'mongodb_connected', host: conn.connection.host });
    return conn;
  } catch (error) {
    logger.error('mongodb_connection_error', { action: 'mongodb_connection_error', error: error.message });
    process.exit(1);
  }
};

export const disconnectDB = async () => {
  try {
    await mongoose.disconnect();
    logger.info('mongodb_disconnected', { action: 'mongodb_disconnected' });
  } catch (error) {
    logger.error('mongodb_disconnect_error', { action: 'mongodb_disconnect_error', error: error.message });
  }
};
