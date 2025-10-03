import { Router } from 'express';
import { pool } from '../db';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const router = Router();

type Usuario = {
  id: string;
  correo: string;
  nombre_mostrar: string | null;
  contrasena_hash?: string;
  activo?: boolean;
};

function signJwt(u: Usuario) {
  return jwt.sign(
    { sub: u.id, correo: u.correo, nombre_mostrar: u.nombre_mostrar },
    process.env.JWT_SECRET as string,
    { algorithm: 'HS256', expiresIn: process.env.JWT_EXPIRES || '45m' }
  );
}

// POST /api/v1/auth/registrar
router.post('/registrar', async (req, res) => {
  try {
    const { correo, contrasena, nombre_mostrar } = req.body || {};
    if (!correo || !contrasena) return res.status(400).json({ error: 'Faltan campos' });

    const exists = await pool.query('SELECT 1 FROM public.usuarios WHERE correo = $1', [correo]);
    if (exists.rowCount) return res.status(409).json({ error: 'Correo ya registrado' });

    const hash = await bcrypt.hash(contrasena, 12);
    const q = `INSERT INTO public.usuarios (correo, contrasena_hash, nombre_mostrar)
               VALUES ($1,$2,$3)
               RETURNING id, correo, nombre_mostrar`;
    const r = await pool.query(q, [correo, hash, nombre_mostrar || null]);
    const user: Usuario = r.rows[0];

    const token = signJwt(user);
    return res.status(201).json({ access_token: token, user });
  } catch (e) {
    console.error('registrar:', e);
    return res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/v1/auth/login
router.post('/login', async (req, res) => {
  try {
    const { correo, contrasena } = req.body || {};
    if (!correo || !contrasena) return res.status(400).json({ error: 'Faltan campos' });

    const q = `SELECT id, correo, contrasena_hash, nombre_mostrar, activo
               FROM public.usuarios WHERE correo = $1`;
    const r = await pool.query(q, [correo]);
    if (!r.rowCount) return res.status(401).json({ error: 'Credenciales inválidas' });

    const u = r.rows[0] as Usuario;
    if (u.activo === false) return res.status(403).json({ error: 'Usuario inactivo' });

    const ok = await bcrypt.compare(contrasena, (u as any).contrasena_hash);
    if (!ok) return res.status(401).json({ error: 'Credenciales inválidas' });

    const token = signJwt(u);
    return res.json({
      access_token: token,
      user: { id: u.id, correo: u.correo, nombre_mostrar: u.nombre_mostrar }
    });
  } catch (e) {
    console.error('login:', e);
    return res.status(500).json({ error: 'Error del servidor' });
  }
});

// GET /api/v1/auth/me (protegido por JWT)
router.get('/me', jwtGuard, async (req: any, res) => {
  try {
    const sub = req.user?.sub;
    if (!sub) return res.status(401).json({ error: 'No autorizado' });

    const q = `SELECT id, correo, nombre_mostrar, avatar_url, creado_en, actualizado_en
               FROM public.usuarios WHERE id = $1`;
    const r = await pool.query(q, [sub]);
    if (!r.rowCount) return res.status(404).json({ error: 'No encontrado' });

    return res.json({ user: r.rows[0] });
  } catch (e) {
    console.error('me:', e);
    return res.status(500).json({ error: 'Error del servidor' });
  }
});

// --- Middleware JWT local a este router ---
function jwtGuard(req: any, res: any, next: any) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No autorizado' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET as string);
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido' });
  }
}

export default router;
