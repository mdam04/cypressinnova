
import { config } from 'dotenv';
config();

import '@/ai/flows/generate-cypress-test.ts';
import '@/ai/flows/identify-user-flows-flow.ts';
import '@/ai/flows/execute-cypress-open-flow.ts'; // Keep old name for now to avoid breaking existing references if any, but new flow is executeCypressRunHeadless
