
import { config } from 'dotenv';
config();

import '@/ai/flows/generate-cypress-test.ts';
import '@/ai/flows/identify-user-flows-flow.ts';
import '@/ai/flows/execute-cypress-run-headless-flow.ts'; // Updated filename
