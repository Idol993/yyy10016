import { createServer } from 'http';
import bcrypt from 'bcryptjs';
import app from './app.js';
import { initStore, setDemoPasswordHash } from './db/store.js';
import { setupWebSocket } from './ws/handler.js';
import { prewarmPool } from './services/sandbox.js';

const PORT = process.env.PORT || 3001;

async function bootstrap() {
  initStore();

  const demoHash = await bcrypt.hash('demo123', 10);
  setDemoPasswordHash(demoHash);

  prewarmPool();

  const server = createServer(app);

  setupWebSocket(server);

  server.listen(PORT, () => {
    console.log(`Server ready on port ${PORT}`);
    console.log(`WebSocket server ready`);
  });

  process.on('SIGTERM', () => {
    console.log('SIGTERM signal received');
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  });

  process.on('SIGINT', () => {
    console.log('SIGINT signal received');
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  });
}

bootstrap();

export default app;
