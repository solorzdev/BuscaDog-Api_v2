import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'node:path';
import os from 'node:os';

import perfil from './routes/perfil';
import veterinarias from './routes/veterinarias';
import auth from './routes/auth';

const app = express();

// ============================
// 🔧 CONFIGURACIÓN BÁSICA
// ============================
console.log('PUBLIC_BASE_URL:', process.env.PUBLIC_BASE_URL);

const PORT = Number(process.env.PORT ?? 8080);
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ?? `http://localhost:${PORT}`;
const NODE_ENV = process.env.NODE_ENV ?? 'development';
const DB_HOST = process.env.PGHOST ?? 'localhost';
const DB_NAME = process.env.PGDATABASE ?? '(sin nombre)';
const DB_USER = process.env.PGUSER ?? '(sin usuario)';

// ============================
// 🧱 MIDDLEWARES
// ============================
app.use(cors());
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(morgan('dev'));
app.use(express.json({ limit: '5mb' }));

// ============================
// 🗂️ ARCHIVOS ESTÁTICOS
// ============================
const uploadsDir = path.join(process.cwd(), 'uploads');
// app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));
app.use('/uploads', express.static(uploadsDir)); 

// opcional, cache agresiva para avatares:
app.use('/uploads/avatars', express.static(path.join(uploadsDir, 'avatars'), {
  maxAge: '30d',
  immutable: true,
}));

// ============================
// 🚦 RUTAS
// ============================
app.use('/api/v1/usuarios', perfil);
app.use('/api/v1/veterinarias', veterinarias);
app.use('/api/v1/auth', auth);

app.get('/health', (_req, res) => res.json({ ok: true }));

// Catch-all para 404
app.use((_req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

// ============================
// 🚀 ARRANQUE DEL SERVIDOR
// ============================
app.listen(PORT, () => {
  const now = new Date().toLocaleString('es-MX', { hour12: false });
  const localIPs = Object.values(os.networkInterfaces())
    .flat()
    .filter((iface): iface is os.NetworkInterfaceInfo => !!iface && iface.family === 'IPv4' && !iface.internal)
    .map((iface) => iface.address);

  console.clear();
  console.log('==============================================');
  console.log('🚀 BUSCADOG API — Servidor iniciado correctamente');
  console.log('==============================================');
  console.log(`📅 Inicio:     ${now}`);
  console.log(`🌐 Entorno:    ${NODE_ENV}`);
  console.log(`🔌 Puerto:     ${PORT}`);
  console.log(`🖥️  Host local: http://localhost:${PORT}`);
  localIPs.forEach((ip) =>
    console.log(`📱 Red local:  http://${ip}:${PORT}`)
  );
  console.log('----------------------------------------------');
  console.log(`💾 Base de datos: ${DB_NAME}`);
  console.log(`👤 Usuario DB:    ${DB_USER}`);
  console.log(`🗄️  Servidor DB:  ${DB_HOST}`);
  console.log('----------------------------------------------');
  console.log(`📂 Carpeta uploads: ${uploadsDir}`);
  console.log(`🌎 URL pública base: ${PUBLIC_BASE_URL}`);
  console.log('----------------------------------------------');
  console.log('🧩 Rutas montadas:');
  console.log('   → /api/v1/usuarios');
  console.log('   → /api/v1/veterinarias');
  console.log('   → /api/v1/auth');
  console.log('   → /uploads (estático)');
  console.log('==============================================\n');
});
