import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { dbQuery } from '../db.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'super_secreto';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '7d';

// =============== REGISTRO ===============
router.post('/registrar', async (req, res) => {
  try {
    const { correo, contrasena, nombre_mostrar } = req.body;

    if (!correo || !contrasena)
      return res.status(400).json({ error: 'Faltan datos obligatorios.' });

    // Encriptar contraseña
    const hash = await bcrypt.hash(contrasena, 12);

    const insert = `
      INSERT INTO public.usuarios (correo, contrasena_hash, nombre_mostrar)
      VALUES ($1, $2, $3)
      RETURNING id, correo, nombre_mostrar, creado_en;
    `;
    const { rows } = await dbQuery(insert, [correo, hash, nombre_mostrar || null]);
    const user = rows[0];

    // Crear token
    const token = jwt.sign(
      { sub: user.id, correo: user.correo },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES }
    );

    res.status(201).json({ access_token: token, user });
  } catch (err: any) {
    console.error(err);
    if (err.code === '23505') {
      return res.status(409).json({ error: 'El correo ya está registrado.' });
    }
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// =============== LOGIN ===============
router.post('/login', async (req, res) => {
  try {
    const { correo, contrasena } = req.body;

    if (!correo || !contrasena)
      return res.status(400).json({ error: 'Correo y contraseña son requeridos.' });

    const query = `SELECT * FROM public.usuarios WHERE correo = $1 LIMIT 1;`;
    const { rows } = await dbQuery(query, [correo]);
    const user = rows[0];

    if (!user) return res.status(401).json({ error: 'Credenciales inválidas.' });

    const match = await bcrypt.compare(contrasena, user.contrasena_hash);
    if (!match) return res.status(401).json({ error: 'Credenciales inválidas.' });

    const token = jwt.sign(
      { sub: user.id, correo: user.correo },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES }
    );

    delete user.contrasena_hash; // no enviamos el hash
    res.json({ access_token: token, user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor.' });
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
