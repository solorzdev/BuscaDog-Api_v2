import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { dbQuery } from '../db.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'super_secreto';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '7d';

/* ================== REGISTRO ================== */
router.post('/registrar', async (req, res) => {
  const { correo, contrasena, nombre_mostrar } = req.body ?? {};
  if (!correo || !contrasena) return res.status(400).json({ error: 'Faltan datos.' });
  if (!process.env.JWT_SECRET) return res.status(500).json({ error: 'JWT mal configurado en el servidor.' });

  try {
    const hash = await bcrypt.hash(contrasena, 12);

    // 1) Inserta usuario
    const rows = await dbQuery(
      `INSERT INTO public.usuarios (correo, contrasena_hash, nombre_mostrar)
       VALUES ($1,$2,$3)
       RETURNING id, correo, nombre_mostrar, creado_en;`,
      [correo, hash, nombre_mostrar ?? null]
    );
    const user = rows[0];

    // 2) Asigna rol "normal" (update-then-insert para convivir con UNIQUE deferrable)
    const roleRows = await dbQuery(`SELECT id FROM public.roles WHERE codigo='normal' LIMIT 1;`);
    if (roleRows.length) {
      const rolId = roleRows[0].id;
      const upd = await dbQuery(
        `UPDATE public.usuario_roles
           SET rol_id=$2, principal=true, asignado_en=now()
         WHERE usuario_id=$1
         RETURNING 1;`,
        [user.id, rolId]
      );
      if (upd.length === 0) {
        await dbQuery(
          `INSERT INTO public.usuario_roles (usuario_id, rol_id, principal)
           VALUES ($1,$2,true);`,
          [user.id, rolId]
        );
      }
    }

    // 3) Saca rol para la respuesta
    const rolRow = await dbQuery(
      `SELECT r.codigo AS rol_codigo
         FROM public.usuario_roles ur
         JOIN public.roles r ON r.id = ur.rol_id
        WHERE ur.usuario_id = $1
        LIMIT 1;`,
      [user.id]
    );
    const rol_codigo = rolRow[0]?.rol_codigo ?? 'normal';

    const token = jwt.sign(
      { sub: String(user.id), correo: user.correo, rol: rol_codigo },
      process.env.JWT_SECRET as string,
      { expiresIn: JWT_EXPIRES }
    );

    res.status(201).json({
      access_token: token,
      user: { ...user, rol_codigo }
    });
  } catch (e: any) {
    console.error('[AUTH /registrar] code:', e?.code, 'message:', e?.message);
    if (e?.code === '23505') return res.status(409).json({ error: 'El correo ya está registrado.' });
    return res.status(500).json({ error: 'Error interno del servidor.' });
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
