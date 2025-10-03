import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

import veterinarias from './routes/veterinarias';
import auth from './routes/auth';   // 👈 importa el nuevo router

const app = express();

// Middlewares de seguridad, logging y parsing JSON
app.use(cors());     
app.use(helmet());
app.use(morgan('dev'));
app.use(express.json());  // 👈 necesario para leer req.body en JSON

// Ruta de prueba
app.get('/health', (_req, res) => res.json({ ok: true }));

// Rutas de la API
app.use('/api/v1/veterinarias', veterinarias);
app.use('/api/v1/auth', auth);   // 👈 ahora tienes /registrar, /login, /me

// Arrancar servidor
const port = Number(process.env.PORT ?? 8080);
app.listen(port, () => {
  console.log(`API BUSCADOG escuchando en http://localhost:${port}`);
});

console.log('Conectando a DB:', process.env.PGDATABASE, 'en', process.env.PGHOST);
