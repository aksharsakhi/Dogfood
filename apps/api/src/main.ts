import 'reflect-metadata';
import { createApp } from './bootstrap';
import { loadEnvironment } from './config';
async function main() {
  const env = loadEnvironment();
  const app = await createApp(env.WEB_ORIGIN);
  await app.listen(env.API_PORT, '0.0.0.0');
}
void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
