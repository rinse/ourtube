import serverlessExpress from '@codegenie/serverless-express';
import { createAppConfig } from '../config';
import { createDependencies } from '../dependencies';
import { createApp } from '../app';

// Built once per cold start and reused across invocations.
const app = createApp(createDependencies(createAppConfig()));

export const handler = serverlessExpress({ app });
