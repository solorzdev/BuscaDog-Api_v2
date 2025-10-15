import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { dbQuery } from '../db.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'super_secreto';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '7d';

// =============== REGISTRO ===============
router.post('/registrar', async (req, res) => {
  const { correo, contrasena, nombre_mostrar } = req.body ?? {};
  if (!correo || !contrasena) return res.status(400).json({ error: 'Faltan datos.' });

  const JWT_SECRET = process.env.JWT_SECRET;
  if (!JWT_SECRET) return res.status(500).json({ error: 'JWT mal configurado en el servidor.' });

  try {
    const hash = await bcrypt.hash(contrasena, 12);

    const rows = await dbQuery(
      `INSERT INTO public.usuarios (correo, contrasena_hash, nombre_mostrar)
       VALUES ($1,$2,$3)
       RETURNING id, correo, nombre_mostrar, creado_en;`,
      [correo, hash, nombre_mostrar ?? null]
    );
    const user = rows[0];

    const token = jwt.sign(
      { sub: String(user.id), correo: user.correo },
      JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES || '7d' }
    );

    res.status(201).json({ access_token: token, user });
  } catch (e: any) {
    console.error('[AUTH /registrar] code:', e?.code, 'message:', e?.message);
    if (e?.code === '23505') return res.status(409).json({ error: 'El correo ya está registrado.' });
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// =============== LOGIN ===============
router.post('/login', async (req, res) => {
  const { correo, contrasena } = req.body ?? {};
  if (!correo || !contrasena) {
    return res.status(400).json({ error: 'Correo y contraseña son requeridos.' });
  }
  if (!process.env.JWT_SECRET) {
    return res.status(500).json({ error: 'JWT mal configurado en el servidor.' });
  }

  try {
    // dbQuery devuelve un array de filas
    const rows = await dbQuery(
      `SELECT id, correo, nombre_mostrar, contrasena_hash
       FROM public.usuarios
       WHERE correo = $1
       LIMIT 1;`,
      [correo]
    );

    const user = rows[0];
    if (!user) {
      return res.status(401).json({ error: 'Credenciales inválidas.' });
    }

    const ok = await bcrypt.compare(contrasena, user.contrasena_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Credenciales inválidas.' });
    }

    // no regreses el hash
    delete (user as any).contrasena_hash;

    const token = jwt.sign(
      { sub: String(user.id), correo: user.correo },
      process.env.JWT_SECRET as string,
      { expiresIn: process.env.JWT_EXPIRES || '7d' }
    );

    return res.json({ access_token: token, user });
  } catch (e: any) {
    console.error('[AUTH /login]', e?.code, e?.message);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// =============== PERFIL (Token) ===============
router.get('/me', async (req, res) => {
  try {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer '))
      return res.status(401).json({ error: 'Token no proporcionado.' });

    const token = auth.slice(7);
    const payload = jwt.verify(token, JWT_SECRET) as { sub: number };

    const { rows } = await dbQuery(
      `SELECT id, correo, nombre_mostrar, creado_en
       FROM public.usuarios WHERE id = $1;`,
      [payload.sub]
    );

    const user = rows[0];
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });

    res.json({ user });
  } catch (err) {
    console.error(err);
    res.status(401).json({ error: 'Token inválido o expirado.' });
  }
});

export default router;
