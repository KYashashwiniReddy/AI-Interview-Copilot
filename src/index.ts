import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// Load environment variables immediately with override configuration
const result = dotenv.config({ override: true });
console.log('Parsed dotenv config:', result.parsed);
console.log('Dotenv error (if any):', result.error);
console.log('CWD is:', process.cwd());
console.log('Dotenv path:', path.resolve(process.cwd(), '.env'));
console.log('Does .env exist at path:', fs.existsSync(path.resolve(process.cwd(), '.env')));
console.log('SUPABASE_URL in index.ts:', process.env.SUPABASE_URL);
console.log('PORT in index.ts:', process.env.PORT);

// Import routes
import authRoutes from './routes/authRoutes';
import atsRoutes from './routes/atsRoutes';
import roadmapRoutes from './routes/roadmapRoutes';
import interviewRoutes from './routes/interviewRoutes';
import adminRoutes from './routes/adminRoutes';
import notificationRoutes from './routes/notificationRoutes';
import jobRoutes from './routes/jobRoutes';

const app = express();
const PORT = process.env.PORT || 8000;

// Enable CORS
app.use(cors({
  origin: '*', // Allow all origins for development and integration
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Body parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve local upload assets (resumes, audio recordings)
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'healthy', timestamp: new Date() });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/ats', atsRoutes);
app.use('/api/roadmap', roadmapRoutes);
app.use('/api/interviews', interviewRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/job-roles', jobRoutes);

// Global Error Handler Middleware
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('Unhandled Server Error:', err);
  const status = err.status || 500;
  const message = err.message || 'Internal Server Error';
  res.status(status).json({ error: message });
});

// Start Server
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`===================================================`);
    console.log(` NOVAHIRE AI BACKEND IS RUNNING`);
    console.log(` URL: http://localhost:${PORT}`);
    console.log(` Database: SQLite/PostgreSQL initialized`);
    console.log(` Mode: ${process.env.NODE_ENV || 'development'}`);
    console.log(`===================================================`);
  });
}

// For integration testing
export default app;
export { app };
