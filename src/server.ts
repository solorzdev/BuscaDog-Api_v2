import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import perfil from './routes/perfil';
import veterinarias from './routes/veterinarias';
import auth from './routes/auth';  

const app = express();

// Middlewares de seguridad, logging y parsing JSON
app.use(cors());     
app.use(helmet());
app.use(morgan('dev'));
app.use(express.json());  
app.use('/api/v1/veterinarias', veterinarias);
app.use('/api/v1/auth', auth);
app.use('/api/v1/usuarios', perfil); 


// Ruta de prueba
app.get('/health', (_req, res) => res.json({ ok: true }));

// Rutas de la API
app.use('/api/v1/veterinarias', veterinarias);
app.use('/api/v1/auth', auth);  

// Arrancar servidor
const port = Number(process.env.PORT ?? 8080);
app.listen(port, () => {
  console.log(`API BUSCADOG escuchando en http://localhost:${port}`);
});

console.log('Conectando a DB:', process.env.PGDATABASE, 'en', process.env.PGHOST);
