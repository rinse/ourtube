import dotenv from 'dotenv';
import { createAppConfig } from './config';
import { createDependencies } from './dependencies';
import { createApp } from './app';

/** Local development entrypoint: runs the same app the Lambda adapter wraps. */
dotenv.config();

const config = createAppConfig();
console.log('AppConfiguration:', JSON.stringify(config, null, 2));

const deps = createDependencies(config);
const app = createApp(deps);

app.listen(config.port, () => {
  console.log(`API server running on http://localhost:${config.port}`);
});
