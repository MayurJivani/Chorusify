import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  // Defaults to production because several security decisions key off this value: secure cookies,
  // whether error responses carry a stack, and whether a password reset token is echoed back to
  // the caller. Defaulting to development made all three fail *open* on any deploy that forgot to
  // set NODE_ENV. The dev and test runners set it explicitly, so only an unconfigured deploy hits
  // this default, and that deploy should get the locked-down behaviour.
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  PORT: z.coerce.number().int().positive().default(8888),
  DATABASE_URL: z
    .string()
    .min(1)
    .refine(
      (value) => value.startsWith('postgres://') || value.startsWith('postgresql://'),
      'DATABASE_URL must be a postgres:// or postgresql:// connection string',
    ),
  SESSION_SECRET: z
    .string()
    .min(
      32,
      'SESSION_SECRET must be at least 32 characters, generate one with `openssl rand -hex 32`',
    ),
  CSRF_SECRET: z
    .string()
    .min(
      32,
      'CSRF_SECRET must be at least 32 characters, generate one with `openssl rand -hex 32`',
    ),
  CORS_ORIGIN: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    console.error('Invalid environment configuration:');
    for (const issue of parsed.error.issues) {
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }

  return parsed.data;
}

export const env = loadEnv();
