import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { dbQuery } from '../db.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'super_secreto';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '7d';

/* ================== REGISTRO ================== */
router.post(['/registrar', '/register'], async (req, res) => {
  try {
    const b = req.body ?? {};
    const nombre = (b.nombre ?? '').trim();
    const correo = (b.correo ?? '').trim().toLowerCase();
    const pass   = (b.contrasena ?? '').toString();

    if (!nombre || !correo || !pass) {
      return res.status(400).json({ error: 'Faltan campos obligatorios' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
      return res.status(422).json({ error: 'Correo no válido' });
    }
    if (pass.length < 8 || !/[A-Za-z]/.test(pass) || !/\d/.test(pass)) {
      return res.status(422).json({ error: 'Contraseña débil' });
    }

    // correo único (case-insensitive)
    const dupe = await dbQuery(
      `SELECT 1 FROM public.usuarios WHERE lower(correo)=lower($1) LIMIT 1;`,
      [correo]
    );
    if (dupe.length) return res.status(409).json({ error: 'Correo ya registrado' });

    const hash = await bcrypt.hash(pass, 10);

    const rows = await dbQuery(
      `
      INSERT INTO public.usuarios (
        correo, contrasena_hash, nombre, apellidos, nombre_mostrar,
        telefono, whatsapp, creado_en, actualizado_en, activo
      ) VALUES (
        $1, $2, $3, NULLIF($4,''), NULLIF($5,''),
        NULLIF($6,''), NULLIF($7,''), now(), now(), true
      )
      RETURNING id, correo, nombre, apellidos, nombre_mostrar,
                telefono, whatsapp, avatar_url, creado_en, actualizado_en;
      `,
      [
        correo,
        hash,
        nombre,
        (b.apellidos ?? '').trim(),
        (b.nombre_mostrar ?? '').trim(),
        (b.telefono ?? '').trim(),
        (b.whatsapp ?? '').trim(),
      ]
    );

    const user = rows[0];
    const token = jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: '30d' });

    return res.status(201).json({ user, token });
  } catch (err: any) {
    console.error('POST /auth/register', err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

/* ================== LOGIN ================== */
router.post('/login', async (req, res) => {
  const { correo, contrasena } = req.body ?? {};
  if (!correo || !contrasena) return res.status(400).json({ error: 'Correo y contraseña son requeridos.' });
  if (!process.env.JWT_SECRET) return res.status(500).json({ error: 'JWT mal configurado en el servidor.' });

  try {
    // Trae hash + rol
    const rows = await dbQuery(
      `SELECT u.id, u.correo, u.nombre_mostrar, u.contrasena_hash,
              COALESCE(r.codigo, 'normal') AS rol_codigo
         FROM public.usuarios u
    LEFT JOIN public.usuario_roles ur ON ur.usuario_id = u.id
    LEFT JOIN public.roles r          ON r.id = ur.rol_id
        WHERE u.correo = $1
        LIMIT 1;`,
      [correo]
    );

    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Credenciales inválidas.' });

    const ok = await bcrypt.compare(contrasena, user.contrasena_hash);
    if (!ok) return res.status(401).json({ error: 'Credenciales inválidas.' });

    delete (user as any).contrasena_hash;

    const token = jwt.sign(
      { sub: String(user.id), correo: user.correo, rol: user.rol_codigo },
      process.env.JWT_SECRET as string,
      { expiresIn: JWT_EXPIRES }
    );

    return res.json({ access_token: token, user });
  } catch (e: any) {
    console.error('[AUTH /login]', e?.code, e?.message);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

/* ================== PERFIL (Token) ================== */
router.get('/me', async (req, res) => {
  try {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Token no proporcionado.' });

    const token = auth.slice(7);
    const payload = jwt.verify(token, JWT_SECRET) as { sub: string | number };

    const rows = await dbQuery(
      `SELECT u.id, u.correo, u.nombre_mostrar, u.creado_en,
              COALESCE(r.codigo, 'normal') AS rol_codigo
         FROM public.usuarios u
    LEFT JOIN public.usuario_roles ur ON ur.usuario_id = u.id
    LEFT JOIN public.roles r          ON r.id = ur.rol_id
        WHERE u.id = $1
        LIMIT 1;`,
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
