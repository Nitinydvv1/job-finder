import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import multer from 'multer';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const upload = multer({ dest: 'uploads/' });

interface MulterRequest extends Request {
  file?: any;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Start listening immediately to satisfy the platform's health check
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on port ${PORT}`);
  });

  // API Routes
  app.post('/api/upload-resume', upload.single('resume'), async (req: MulterRequest, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const dataBuffer = fs.readFileSync(req.file.path);
      // Lazy load pdf-parse correctly using the PDFParse class
      const { PDFParse } = await import('pdf-parse');
      
      let text = '';
      try {
        const parser = new PDFParse({ data: dataBuffer });
        const result = await parser.getText();
        text = result.text;
        await parser.destroy();
      } catch (pdfError) {
        console.error('PDF parsing error:', pdfError);
        throw new Error('Failed to extract text from PDF. Please ensure it is a valid PDF file.');
      }

      // Clean up uploaded file
      fs.unlinkSync(req.file.path);

      if (!text || text.trim().length === 0) {
        throw new Error('The uploaded PDF appears to be empty or unreadable.');
      }

      res.json({
        fileName: req.file.originalname,
        text
      });
    } catch (error: any) {
      console.error('Upload error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    console.log('Initializing Vite...');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    console.log('Vite initialized.');
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }
}

startServer();
