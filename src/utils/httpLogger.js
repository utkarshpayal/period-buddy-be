import morgan from 'morgan';
import logger from './logger.js';

// Stream Morgan into Winston
const stream = {
  write: (message) => logger.http(message.trim()),
};

const httpLogger = morgan(
  ':remote-addr :method :url :status :res[content-length] - :response-time ms',
  { stream }
);

export default httpLogger;
